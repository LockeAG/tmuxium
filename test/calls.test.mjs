import test from 'node:test';
import assert from 'node:assert/strict';
import { isCall } from '../src/calls.js';

// A real meeting URL for each provider we claim to support.
const CALLS = [
  'https://meet.google.com/abc-defg-hij',
  'https://meet.google.com/abc-defg-hij?authuser=0',
  'https://zoom.us/j/1234567890',
  'https://zoom.us/wc/join/1234567890',
  'https://app.zoom.us/wc/1234567890/join',
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0',
  'https://teams.live.com/meet/9312345678901',
  'https://acme.webex.com/meet/adrian',
  'https://acme.webex.com/join/adrian',
  'https://acme.webex.com/wbxmjs/joinservice/sites/acme/meeting/download/abc',
  'https://acme.webex.com/webappng/sites/acme/meeting/info/abc123',
  'https://acme.webex.com/acme/j.php?MTID=m123abc',
  'https://app.chime.aws/meetings/1234567890',
  'https://meet.goto.com/123456789',
  'https://app.goto.com/meeting/abc123',
  'https://global.gotomeeting.com/join/123456789',
  'https://bluejeans.com/123456789',
  'https://join.skype.com/abcDEF123',
  'https://meet.jit.si/DreamsEngineStandup',
  'https://meet.around.co/r/dreams',
  'https://app.gather.town/app/abc123/office'
];

// Near misses. Every one of these has been a real false positive at some point,
// or is the marketing page of a provider we do support.
const NOT_CALLS = [
  'https://meet.google.com/',
  'https://meet.google.com/landing',
  'https://zoom.us/pricing',
  'https://app.zoom.us/wc/home',
  'https://fakezoom.us/j/1234567890',
  'https://phishing-zoom.us.evil.com/j/1234567890',
  'https://teams.microsoft.com/_#/conversations/General?topic=calling',
  'https://www.webex.com/pricing.html',
  'https://www.webex.com/',
  'https://whereby.com/information/pricing',
  'https://www.gotomeeting.com/pricing',
  'https://www.bluejeans.com/pricing',
  'https://www.bluejeans.com/10-tips-for-hybrid-work',
  'https://meet.jit.si/static/dialInInfo.html?room=x',
  'https://app.chime.aws/portal',
  'https://app.gather.town/',
  'https://www.gather.town/pricing',
  'https://meet.around.co/',
  'https://www.around.co/pricing',
  'https://meet.goto.com/',
  'https://www.skype.com/en/',
  'https://discord.com/channels/12345/67890',
  'https://app.slack.com/client/T123/C456',
  'https://github.com/LockeAG/tmuxium',
  'chrome://extensions/',
  '',
  undefined,
  null
];

test('recognises a real meeting URL for every supported provider', () => {
  for (const url of CALLS) {
    assert.equal(isCall(url), true, `should be a call: ${url}`);
  }
});

test('rejects landing pages, lookalike hosts and ordinary tabs', () => {
  for (const url of NOT_CALLS) {
    assert.equal(isCall(url), false, `should not be a call: ${url}`);
  }
});
