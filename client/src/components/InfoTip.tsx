interface InfoTipProps {
  text: string;
}

export default function InfoTip({ text }: InfoTipProps) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 4, cursor: 'help' }} className="info-tip">
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '50%',
          fontSize: 9,
          fontWeight: 700,
          background: 'rgba(148,163,184,0.2)',
          color: '#94a3b8',
          lineHeight: 1,
        }}
      >
        i
      </span>
      <span className="info-tip-text">
        {text}
      </span>
    </span>
  );
}
