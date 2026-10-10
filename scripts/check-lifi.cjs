// envil loads local .env; an injected container environment takes precedence.
require('envil');
const apiKey = process.env.LIFI_API_KEY?.trim();
if (!apiKey) {
  console.error('LIFI_API_KEY is missing in this runtime.');
  process.exitCode = 1;
} else {
  (async () => {
    try {
      const response = await fetch('https://li.quest/v1/keys/test', {
        headers: { 'x-lifi-api-key': apiKey }, signal: AbortSignal.timeout(15000),
      });
      console.log(`LI.FI runtime key check: HTTP ${response.status}.`);
      if (!response.ok) {
        console.error('Check the active key and LI.FI access restrictions.');
        process.exitCode = 1;
      }
    } catch {
      console.error('LI.FI runtime key check failed to reach the provider.');
      process.exitCode = 1;
    }
  })();
}
