'use client';

import React, { useEffect, useRef, useState } from 'react';
import api from '@/src/lib/api';

type CaptchaConfigResponse = {
  enabled?: boolean;
  siteKey?: string;
  configured?: boolean;
};

type CaptchaChallengeProps = {
  onTokenChange: (token: string) => void;
  onRequirementChange?: (required: boolean) => void;
  refreshNonce?: number;
  className?: string;
};

const TURNSTILE_SCRIPT_ID = 'turnstile-explicit-api';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const loadTurnstileScript = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  if ((window as any).turnstile) {
    return;
  }

  const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existingScript) {
    await new Promise<void>((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load CAPTCHA script')), {
        once: true,
      });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load CAPTCHA script'));
    document.head.appendChild(script);
  });
};

export default function CaptchaChallenge({
  onTokenChange,
  onRequirementChange,
  refreshNonce = 0,
  className,
}: CaptchaChallengeProps) {
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isEnabled, setIsEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchCaptchaConfig = async () => {
      setIsLoadingConfig(true);
      setErrorMessage('');

      const disableCaptcha = () => {
        setIsEnabled(false);
        setSiteKey('');
        onRequirementChange?.(false);
        onTokenChange('');
      };

      try {
        const { data } = await api.get<CaptchaConfigResponse>('/auth/captcha/config');
        if (!mounted) {
          return;
        }

        const enabled = Boolean(data?.enabled);
        const configured = data?.configured !== false;
        const resolvedSiteKey = String(data?.siteKey || '').trim();

        // Missing / placeholder Turnstile config => do not render or require captcha.
        if (!enabled || !configured || !resolvedSiteKey) {
          disableCaptcha();
          return;
        }

        setIsEnabled(true);
        setSiteKey(resolvedSiteKey);
        onRequirementChange?.(true);
      } catch {
        if (!mounted) {
          return;
        }
        // Config endpoint unreachable — skip captcha instead of blocking login.
        disableCaptcha();
      } finally {
        if (mounted) {
          setIsLoadingConfig(false);
        }
      }
    };

    fetchCaptchaConfig();

    return () => {
      mounted = false;
    };
  }, [onRequirementChange, onTokenChange, refreshNonce]);

  useEffect(() => {
    if (!isEnabled || !siteKey || isLoadingConfig) {
      return;
    }

    let cancelled = false;

    const renderCaptcha = async () => {
      try {
        await loadTurnstileScript();
        if (cancelled) {
          return;
        }

        const turnstile = (window as any).turnstile;
        if (!turnstile || !containerRef.current) {
          setErrorMessage('Failed to load security challenge.');
          onTokenChange('');
          return;
        }

        if (widgetIdRef.current !== null) {
          try {
            turnstile.remove(widgetIdRef.current);
          } catch {
            // Ignore stale widget cleanup errors.
          }
          widgetIdRef.current = null;
        }

        containerRef.current.innerHTML = '';
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token: string) => {
            onTokenChange(token);
            setErrorMessage('');
          },
          'expired-callback': () => {
            onTokenChange('');
          },
          'error-callback': () => {
            onTokenChange('');
            setErrorMessage('Security challenge failed. Please retry.');
          },
        });
      } catch {
        if (cancelled) {
          return;
        }

        onTokenChange('');
        setErrorMessage('Failed to load security challenge.');
      }
    };

    renderCaptcha();

    return () => {
      cancelled = true;
      const turnstile = (window as any).turnstile;

      if (turnstile && widgetIdRef.current !== null) {
        try {
          turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore stale widget cleanup errors.
        }
      }

      widgetIdRef.current = null;
    };
  }, [isEnabled, siteKey, isLoadingConfig, refreshNonce, onTokenChange]);

  if (isLoadingConfig || !isEnabled) {
    return null;
  }

  return (
    <div className={className}>
      <label className="text-[#4b5563] text-sm font-semibold">Security Check</label>
      <div ref={containerRef} className="mt-2 min-h-16.5" />
      {errorMessage ? <p className="mt-2 text-sm text-red-500">{errorMessage}</p> : null}
    </div>
  );
}
