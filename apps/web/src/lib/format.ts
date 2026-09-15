const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | Date): string {
  return DATE_FORMATTER.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return DATE_TIME_FORMATTER.format(new Date(value));
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const RELATIVE_TIME_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** "2 minutes ago", "3 hours ago", falling back to a plain date once it's over a year old. */
export function formatRelativeTime(value: string | Date): string {
  const date = new Date(value);
  const secondsAgo = Math.round((Date.now() - date.getTime()) / 1000);

  if (secondsAgo < 30) {
    return 'just now';
  }

  for (const [unit, secondsInUnit] of RELATIVE_TIME_STEPS) {
    if (secondsAgo >= secondsInUnit) {
      return RELATIVE_TIME_FORMATTER.format(-Math.floor(secondsAgo / secondsInUnit), unit);
    }
  }

  return RELATIVE_TIME_FORMATTER.format(-secondsAgo, 'second');
}

/** Two-letter initials used by the avatar components. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}