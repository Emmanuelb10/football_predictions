import dayjs from 'dayjs';

interface DatePickerProps {
  date: string;
  onChange: (date: string) => void;
}

const LAUNCH_DATE = '2026-03-16';

export default function DatePicker({ date, onChange }: DatePickerProps) {
  const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
  const prev = () => { if (prevDate >= LAUNCH_DATE) onChange(prevDate); };
  const next = () => onChange(dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
  const today = () => onChange(dayjs().format('YYYY-MM-DD'));

  const isToday = date === dayjs().format('YYYY-MM-DD');
  const isAtLaunch = date <= LAUNCH_DATE;
  const displayDate = dayjs(date).format('ddd, MMM D, YYYY');

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={prev}
        disabled={isAtLaunch}
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-primary)', color: isAtLaunch ? 'var(--text-secondary)' : 'var(--text-primary)', border: '1px solid var(--border)', opacity: isAtLaunch ? 0.4 : 1, cursor: isAtLaunch ? 'not-allowed' : 'pointer' }}
      >
        &#8592;
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium px-3" style={{ color: 'var(--text-primary)' }}>
          {displayDate}
        </span>
        <input
          type="date"
          value={date}
          min={LAUNCH_DATE}
          onChange={(e) => { if (e.target.value >= LAUNCH_DATE) onChange(e.target.value); }}
          className="px-2 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
      </div>

      <button
        onClick={next}
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      >
        &#8594;
      </button>

      {!isToday && (
        <button
          onClick={today}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent-blue)', color: 'white' }}
        >
          Today
        </button>
      )}
    </div>
  );
}
