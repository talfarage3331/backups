import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { USE_MOCK, auth } from '../services/firebase';

export interface MockUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface AuthContextValue {
  user: MockUser | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Mock auth backed by localStorage ───────────────────────────────────────

const MOCK_USER_KEY = 'sg_mock_user';

function getMockUser(): MockUser | null {
  const raw = localStorage.getItem(MOCK_USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setMockUser(user: MockUser | null) {
  if (user) localStorage.setItem(MOCK_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(MOCK_USER_KEY);
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (USE_MOCK) {
      setUser(getMockUser());
      setLoading(false);
      return;
    }
    // Real Firebase auth - dynamic import to avoid build issues when mock
    let unsub: (() => void) | undefined;
    import('firebase/auth').then(({ onAuthStateChanged }) => {
      unsub = onAuthStateChanged(auth!, (firebaseUser) => {
        setUser(
          firebaseUser
            ? {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
              }
            : null
        );
        setLoading(false);
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // ── Mock implementations ────────────────────────────────────────────────

  async function signUpWithEmail(email: string, _password: string) {
    if (USE_MOCK) {
      const u: MockUser = {
        uid: 'mock-' + Math.random().toString(36).substr(2, 8),
        email,
        displayName: email.split('@')[0],
        photoURL: null,
      };
      setMockUser(u);
      setUser(u);
      return;
    }
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    const cred = await createUserWithEmailAndPassword(auth!, email, _password);
    const fu = cred.user;
    setUser({ uid: fu.uid, email: fu.email, displayName: fu.displayName, photoURL: fu.photoURL });
  }

  async function signInWithEmail(email: string, _password: string) {
    if (USE_MOCK) {
      const u: MockUser = {
        uid: 'mock-' + email.replace(/[^a-z0-9]/gi, ''),
        email,
        displayName: email.split('@')[0],
        photoURL: null,
      };
      setMockUser(u);
      setUser(u);
      return;
    }
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    const cred = await signInWithEmailAndPassword(auth!, email, _password);
    const fu = cred.user;
    setUser({ uid: fu.uid, email: fu.email, displayName: fu.displayName, photoURL: fu.photoURL });
  }

  async function signInWithGoogle() {
    if (USE_MOCK) {
      const u: MockUser = {
        uid: 'mock-google-user',
        email: 'demo@stackguard.dev',
        displayName: 'Demo User',
        photoURL: null,
      };
      setMockUser(u);
      setUser(u);
      return;
    }
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth!, provider);
    const fu = cred.user;
    setUser({ uid: fu.uid, email: fu.email, displayName: fu.displayName, photoURL: fu.photoURL });
  }

  async function signOut() {
    if (USE_MOCK) {
      setMockUser(null);
      setUser(null);
      return;
    }
    const { signOut: fbSignOut } = await import('firebase/auth');
    await fbSignOut(auth!);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
