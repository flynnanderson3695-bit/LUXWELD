// Passport OAuth setup. Strategies are registered ONLY when their credentials
// are present, so unconfigured providers simply don't exist (no broken buttons).
// We don't use passport's persistent session — after the OAuth handshake the
// route upserts the user and sets our own signed `uid` cookie.
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import {
  GOOGLE_ENABLED, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL,
  APPLE_ENABLED, APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CALLBACK_URL,
} from './config.js';

export const googleEnabled = GOOGLE_ENABLED;
export let appleEnabled = APPLE_ENABLED;

if (GOOGLE_ENABLED) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      (_accessToken, _refreshToken, profile, done) => {
        done(null, {
          provider: 'google',
          providerId: profile.id,
          email: profile.emails?.[0]?.value || null,
          name: profile.displayName || null,
        });
      }
    )
  );
  console.log(`Google OAuth enabled → ${GOOGLE_CALLBACK_URL || '(set BASE_URL/GOOGLE_CALLBACK_URL)'}`);
}

if (APPLE_ENABLED) {
  try {
    // Dynamic import so a missing/old package never crashes startup.
    const { default: AppleStrategy } = await import('passport-apple');
    passport.use(
      new AppleStrategy(
        {
          clientID: APPLE_CLIENT_ID,
          teamID: APPLE_TEAM_ID,
          keyID: APPLE_KEY_ID,
          privateKeyString: APPLE_PRIVATE_KEY,
          callbackURL: APPLE_CALLBACK_URL,
          scope: ['name', 'email'],
          passReqToCallback: true,
        },
        (_req, _accessToken, _refreshToken, idToken, _profile, done) => {
          // idToken is the decoded JWT payload (sub, email).
          const payload = typeof idToken === 'string' ? JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString()) : idToken;
          done(null, {
            provider: 'apple',
            providerId: payload?.sub,
            email: payload?.email || null,
            name: null,
          });
        }
      )
    );
    console.log(`Apple OAuth enabled → ${APPLE_CALLBACK_URL || '(set BASE_URL/APPLE_CALLBACK_URL)'}`);
  } catch (e) {
    appleEnabled = false;
    console.warn('Apple OAuth configured but failed to initialise — hiding Apple sign-in:', e.message);
  }
}

if (!googleEnabled) console.log('Google OAuth disabled (set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET).');
if (!APPLE_ENABLED) console.log('Apple OAuth disabled (Apple env vars not set) — button hidden.');

export default passport;
