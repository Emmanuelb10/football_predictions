import { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

const ToastContext = createContext<{ addToast: (msg: string, type: Toast['type']) => void }>({
  addToast: () => {},
});

export const useToast = () => useContext(ToastContext);

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const colors = {
    info: { bg: 'rgba(59,130,246,0.9)', border: '#3b82f6' },
    success: { bg: 'rgba(34,197,94,0.9)', border: '#22c55e' },
    error: { bg: 'rgba(239,68,68,0.9)', border: '#ef4444' },
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: colors[t.type].bg,
              border: `1px solid ${colors[t.type].border}`,
              color: 'white',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              animation: 'toast-in 0.3s ease-out',
              maxWidth: 340,
              backdropFilter: 'blur(8px)',
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
