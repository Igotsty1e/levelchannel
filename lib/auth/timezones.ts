// Pure constants + helpers — NO DB imports. The cabinet's
// profile-editor.tsx is a client component, so anything it imports
// must be bundle-safe. Earlier these lived in lib/auth/profiles.ts
// which transitively imports pg (via lib/db/pool); that pulled the
// pg client into the browser bundle and broke `npm run build` with
// "Module not found: Can't resolve 'tls'".

export const TIMEZONE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { id: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { id: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { id: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { id: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { id: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { id: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { id: 'Asia/Kamchatka', label: 'Петропавловск-Камчатский (UTC+12)' },
  { id: 'Asia/Tbilisi', label: 'Тбилиси (UTC+4)' },
  { id: 'Asia/Yerevan', label: 'Ереван (UTC+4)' },
  { id: 'Asia/Almaty', label: 'Алматы (UTC+6)' },
  { id: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { id: 'Europe/London', label: 'Лондон (UTC+0/+1)' },
  { id: 'Europe/Berlin', label: 'Берлин (UTC+1/+2)' },
  { id: 'America/New_York', label: 'Нью-Йорк (UTC-5/-4)' },
  { id: 'America/Los_Angeles', label: 'Лос-Анджелес (UTC-8/-7)' },
]

export const ALLOWED_TIMEZONES: ReadonlySet<string> = new Set(
  TIMEZONE_OPTIONS.map((t) => t.id),
)

// Defensive helper for render paths: returns a guaranteed-valid IANA
// tz, falling back to Europe/Moscow if the stored value is unknown.
// This is the last line of defence after the validator + DB constraint;
// it exists so a single bad row from a pre-whitelist era can't 500
// the entire cabinet page.
export function safeTimezone(tz: string | null | undefined): string {
  if (tz && ALLOWED_TIMEZONES.has(tz)) return tz
  return 'Europe/Moscow'
}
