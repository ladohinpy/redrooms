// Only these explicit statuses grant or deny access. Unknown statuses are errors.
// Telegram Bot API: https://core.telegram.org/bots/api#chatmember
export function membershipDecision(member) {
  if (!member || typeof member.status !== 'string') return 'error';

  if (['creator', 'administrator', 'member'].includes(member.status)) return 'allowed';
  if (member.status === 'restricted') return member.is_member === true ? 'allowed' : 'denied';
  if (member.status === 'left' || member.status === 'kicked') return 'denied';

  return 'error';
}
