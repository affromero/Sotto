import { AuthButtons } from '../AuthButtons';
import styles from './page.module.css';

export const metadata = {
  title: 'Sign In',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Welcome Back to Sotto</h1>
        <p className={styles.subtitle}>Sign in to continue creating and listening</p>
        <AuthButtons />
        <p className={styles.footer}>
          Don&apos;t have an account? <a href="/auth/signup">Sign up</a>
        </p>
      </div>
    </main>
  );
}
