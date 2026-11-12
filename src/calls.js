// @ts-check
// Which tabs count as a live call, decided from the URL alone.
//
// Every pattern matches a meeting path AND something room-shaped after it.
// Matching a host is not enough: zoom.us, webex.com and the rest all serve
// marketing pages from the same domain, and a pricing page hoisted to the top
// of the tab tree is worse than no hoisting at all.
//
// Deliberately absent:
//   Discord and Slack — joining a voice channel or a huddle does not change
//   the URL, so any pattern would flag every channel and every workspace.
//   Whereby — its rooms and its marketing pages share one URL shape.
//   Teams in-call — Teams rewrites the URL once you join in the browser and
//   leaves nothing reliable behind, so only the join page matches.

export const CALL_PATTERNS = [
  // Google Meet: meeting codes are xxx-xxxx-xxx, sometimes under /meet/.
  /^https:\/\/meet\.google\.com\/(meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
  // Zoom: a numeric meeting id, never /wc/home.
  /^https:\/\/([\w-]+\.)*zoom\.us\/(j\/\d|wc\/(join\/)?\d)/i,
  // Microsoft Teams: join pages only.
  /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//i,
  /^https:\/\/teams\.live\.com\/meet\/[^/?#]+/i,
  // Webex.
  /^https:\/\/([\w-]+\.)*webex\.com\/(meet|join)\/[^/?#]+/i,
  /^https:\/\/([\w-]+\.)*webex\.com\/wbxmjs\/joinservice/i,
  /^https:\/\/([\w-]+\.)*webex\.com\/webappng\/sites\/[^/]+\/meeting\//i,
  // The URL a calendar invite actually lands on.
  /^https:\/\/([\w-]+\.)*webex\.com\/[^/?#]+\/j\.php\?[^#]*MTID=/i,
  // Amazon Chime.
  /^https:\/\/app\.chime\.aws\/meetings\/[^/?#]+/i,
  // GoTo Meeting, current and legacy hosts.
  /^https:\/\/meet\.goto\.com\/[^/?#]+/i,
  /^https:\/\/app\.goto\.com\/meeting\/[^/?#]+/i,
  /^https:\/\/([\w-]+\.)*gotomeeting\.com\/join\/\d/i,
  // BlueJeans: an all-digit meeting id, not a slug that happens to start with
  // a number like /10-tips-for-hybrid-work.
  /^https:\/\/([\w-]+\.)*bluejeans\.com\/\d{6,}(?:[/?#]|$)/i,
  // Skype.
  /^https:\/\/join\.skype\.com\/[^/?#]+/i,
  // Jitsi. /static/ holds the dial-in page you open from inside a meeting.
  /^https:\/\/meet\.jit\.si\/(?!static\/)[^/?#]+/i,
  // Around.
  /^https:\/\/meet\.around\.co\/r\/[^/?#]+/i,
  // Gather.
  /^https:\/\/app\.gather\.town\/app\/[^/?#]+/i
];

export const isCall = (url) => CALL_PATTERNS.some((pattern) => pattern.test(url ?? ''));
