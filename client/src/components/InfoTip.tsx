import { useState, useRef } from 'react';

interface InfoTipProps {
  text: string;
}

export default function InfoTip({ text }: InfoTipProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: Math.min(rect.left + rect.width / 2, window.innerWidth - 160),
    });
  };

  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ position: 'relative', display: 'inline-block', marginLeft: 4, cursor: 'help' }}
      className="info-tip"
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 15,
          height: 15,
          borderRadius: '50%',
          fontSize: 9,
          fontWeight: 700,
          background: 'rgba(148,163,184,0.25)',
          color: '#94a3b8',
          lineHeight: 1,
          verticalAlign: 'middle',
        }}
      >
        i
      </span>
      {pos && (
        <span
          className="info-tip-text"
          style={{
            display: 'block',
            top: pos.top,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
