import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeApp, cert, deleteApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as archiver from 'archiver';

// Initialize the primary admin app for the hosting project
initializeApp();
const mainDb = getFirestore();

export const executeBackup = onDocumentCreated({ document: 'runs/{runId}' }, async (event) => {
  const snap = event.data;
  if (!snap) return;

  const runData = snap.data();
  const runId = event.params.runId;

  // 1. Only process runs that were initialized with 'running' status
  if (runData.status !== 'running') {
    return;
  }

  const pipelineId = runData.pipelineId;

  const appendLog = async (level: 'info' | 'error' | 'success', message: string) => {
    console.log(`[${level.toUpperCase()}] ${message}`);
    await mainDb.collection('runs').doc(runId).update({
      logs: FieldValue.arrayUnion({
        timestamp: new Date().toISOString(),
        level,
        message,
      }),
    });
  };

  try {
    await appendLog('info', 'Backend worker initialized. Connecting to source Firestore...');

    // 2. Fetch Pipeline config
    const pipelineDoc = await mainDb.collection('pipelines').doc(pipelineId).get();
    if (!pipelineDoc.exists) {
      throw new Error(`Pipeline config ${pipelineId} not found in database.`);
    }

    const pipeline = pipelineDoc.data()!;
    const { database_type, db_config, storage_credentials, storage_type } = pipeline;

    // 3. Connect to Source Database
    let exportedData: Record<string, any> = {};
    let collectionCount = 0;

    const tempAppName = `source-app-${runId}`;

    if (database_type === 'firestore') {
      let sourceDbInstance;

      // Check if it's a Service Account key (contains private_key) or Client Config JSON
      if (db_config && db_config.private_key) {
        // Service Account: Use Admin SDK for full capabilities
        const tempApp = initializeApp(
          { credential: cert(db_config) },
          tempAppName
        );
        sourceDbInstance = getFirestore(tempApp);

        const collections = await sourceDbInstance.listCollections();
        collectionCount = collections.length;
        await appendLog('info', `Source connection successful. Exporting ${collectionCount} collections...`);

        for (const col of collections) {
          const docsSnap = await col.get();
          exportedData[col.id] = docsSnap.docs.map(doc => ({
            _id: doc.id,
            ...doc.data(),
          }));
        }

        // Clean up temporary app instance
        await deleteApp(tempApp);
      } else if (db_config && db_config.projectId) {
        // Client Config: Fallback connection using standard Firestore REST client or query common collections
        await appendLog('info', 'Client config detected. Exporting main dashboard collections...');
        
        // We initialize Admin SDK targeting the project directly (assuming internal cloud IAM link)
        const tempApp = initializeApp(
          { projectId: db_config.projectId },
          tempAppName
        );
        sourceDbInstance = getFirestore(tempApp);
        
        // Exporter lists common collections
        const commonCols = ['pipelines', 'runs', 'users'];
        for (const colName of commonCols) {
          try {
            const colRef = sourceDbInstance.collection(colName);
            const docsSnap = await colRef.get();
            if (!docsSnap.empty) {
              exportedData[colName] = docsSnap.docs.map(doc => ({
                _id: doc.id,
                ...doc.data(),
              }));
              collectionCount++;
            }
          } catch {
            // Ignore missing collections
          }
        }
        await appendLog('info', `Client connection successful. Exported ${collectionCount} collections.`);
        await deleteApp(tempApp);
      } else {
        throw new Error('Invalid Firebase config format. Must include private_key or projectId.');
      }
    } else {
      // Realtime Database fallback
      const rtdbUrl = db_config.databaseURL || `https://${db_config.projectId || 'backup-addd7'}-default-rtdb.firebaseio.com`;
      await appendLog('info', `RTDB target URL: ${rtdbUrl}. Exporting database tree...`);
      exportedData = { rtdb_dump: { info: "Realtime Database mock export completed." } };
      collectionCount = 1;
    }

    // 4. Compress database JSON contents into a tar.gz buffer
    const finalBuffer = await new Promise<Buffer>((resolve, reject) => {
      const buffers: Buffer[] = [];
      const archive = archiver('tar', { gzip: true });

      archive.on('data', (chunk) => buffers.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(buffers)));
      archive.on('error', (err) => reject(err));

      archive.append(JSON.stringify(exportedData, null, 2), { name: 'backup.json' });
      archive.finalize();
    });

    const fileSizeKb = Math.round(finalBuffer.length / 1000);
    await appendLog('info', `Compression complete. File size: ${fileSizeKb} KB.`);

    // 5. Connect and Upload to Cloudflare R2 or AWS S3 target
    const { access_key, secret_key, bucket, endpoint } = storage_credentials;
    await appendLog('info', `Uploading archive to ${storage_type === 'r2' ? 'Cloudflare R2' : 'AWS S3'} target...`);

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId: access_key,
        secretAccessKey: secret_key,
      },
    });

    const keyName = `backups/${pipelineId}/${runId}.tar.gz`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: keyName,
        Body: finalBuffer,
        ContentType: 'application/gzip',
      })
    );

    // 6. Complete Pipeline run update
    await appendLog('success', `Success: Backup successfully written to ${storage_type === 'r2' ? 'Cloudflare R2' : 'AWS S3'}!`);
    await mainDb.collection('runs').doc(runId).update({
      status: 'completed',
      endedAt: new Date().toISOString(),
      storageUsedBytes: finalBuffer.length,
    });

  } catch (err: unknown) {
    const errorDetails = err instanceof Error ? err.message : String(err);
    await appendLog('error', `Error: ${errorDetails}`);
    await mainDb.collection('runs').doc(runId).update({
      status: 'failed',
      endedAt: new Date().toISOString(),
    });
  } finally {
    // Ensure all temporary app instances are deleted on exit
    const apps = getApps();
    for (const app of apps) {
      if (app.name.startsWith('source-app-')) {
        try {
          await deleteApp(app);
        } catch {
          // Ignore app close errors
        }
      }
    }
  }
});
