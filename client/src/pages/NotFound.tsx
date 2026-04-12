import { useNavigate, useParams } from 'react-router-dom';
import { LAUNCH_DATE, todayPath } from '../lib/routing';

interface NotFoundProps {
  reason?: 'invalid-format' | 'pre-launch';
}

export default function NotFound({ reason }: NotFoundProps = {}) {
  const navigate = useNavigate();
  const params = useParams();
  const invalidPath = params.date;
  const effectiveReason = reason ?? 'invalid-format';

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="card max-w-md text-center">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          This date isn&apos;t available
        </h1>
        {effectiveReason === 'pre-launch' ? (
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            The app tracks predictions starting <strong>{LAUNCH_DATE}</strong>. Please pick a date on or after launch.
          </p>
        ) : (
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            The URL <code style={{ color: 'var(--accent-red)' }}>{invalidPath ?? '(missing)'}</code> is not a valid date. Use <code>YYYY-MM-DD</code>.
          </p>
        )}
        <button
          onClick={() => navigate(todayPath())}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent-blue)', color: 'white' }}
        >
          Back to today
        </button>
      </div>
    </div>
  );
}
