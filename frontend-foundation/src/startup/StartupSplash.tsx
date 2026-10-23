import { useEffect, useRef, useState, type ReactNode } from "react";

import { createSplashLifecycle } from "./splashLifecycle";
import styles from "./StartupSplash.module.css";

export interface StartupSplashProps {
  children: ReactNode;
  logoSrc: string;
  productName: string;
  ready: boolean;
}

/** Mount once per entry; children keep loading underneath the splash. */
export function StartupSplash({ children, logoSrc, productName, ready }: StartupSplashProps) {
  const [visible, setVisible] = useState(true);
  const lifecycle = useRef<ReturnType<typeof createSplashLifecycle> | null>(null);

  useEffect(() => {
    const current = createSplashLifecycle(() => setVisible(false));
    lifecycle.current = current;
    return () => {
      current.dispose();
      lifecycle.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready) lifecycle.current?.setReady();
  }, [ready]);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [visible]);

  return (
    <>
      <div inert={visible} aria-hidden={visible || undefined}>{children}</div>
      {visible && <div className={styles.splash} role="status" aria-live="polite" aria-label={`Cargando ${productName}`}>
        <div className={styles.content}>
          <img className={styles.logo} src={logoSrc} alt="" width="340" height="340" fetchPriority="high" />
          <strong className={styles.name}>{productName}</strong>
          <span className={styles.message}>Cargando…</span>
          <span className={styles.progress} aria-hidden="true" />
        </div>
      </div>}
    </>
  );
}
