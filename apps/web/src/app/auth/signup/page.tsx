import { AuthButtons } from '../AuthButtons';
import styles from '../login/page.module.css';

export const metadata = { title: 'Sign Up' };

export default function SignupPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Join Sotto</h1>
        <p className={styles.subtitle}>Create your account and start learning through podcasts</p>
        <AuthButtons />
        <p className={styles.footer}>
          Already have an account? <a href="/auth/login">Sign in</a>
        </p>
      </div>
    </main>
  );
}
