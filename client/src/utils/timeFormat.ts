export function formatKickoffTime(kickoff: string): string {
  return new Date(kickoff).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Nairobi',
  });
}
