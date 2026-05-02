# Secure File Drop Policy

To ensure unauthorized devices cannot drop files based only on a server IP, enforce all of the following:

1. **Mutual authentication required**
   - Require device authentication before any upload endpoint is reachable.
   - Use mTLS or signed device tokens bound to device identity.

2. **Network identity is not authorization**
   - Never trust source IP as a sole access control mechanism.
   - Treat server IP visibility as public knowledge.

3. **Short-lived upload permissions**
   - Generate one-time upload URLs or short-lived upload tokens.
   - Bind tokens to user, device, file constraints, and expiration.

4. **Server-side authorization checks on every request**
   - Verify user/session + device trust state for each upload.
   - Reject unknown device fingerprints or revoked credentials.

5. **Rate limits and anomaly detection**
   - Apply per-device and per-account limits.
   - Trigger alerts for repeated failed upload attempts.

6. **Audit trail**
   - Log denied and accepted upload attempts with device ID, account, and reason.

7. **Safe failure behavior**
   - Default deny when auth context is missing or invalid.

## Example middleware checklist

- [ ] Validate auth token.
- [ ] Check token scope includes `upload:file`.
- [ ] Confirm device is enrolled and trusted.
- [ ] Confirm token not expired and nonce unused.
- [ ] Confirm destination path is allowed.
- [ ] Run content scanning and size/type checks.
- [ ] Persist audit event.
