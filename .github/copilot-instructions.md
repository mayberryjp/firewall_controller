# Repository conventions

## Non-disruptive editing (persistent project preference)

- Do not add arbitrary popup warnings or confirmation dialogs, including `window.alert` or `window.confirm`, for ordinary edits or on/off toggles unless explicitly requested by the user.
- Route enable/disable changes must stage directly without a warning popup, both from the Status toggle and the inline editor.
- Rely on the existing SAVE/apply review flow. Keep validation and necessary feedback inline; do not invent additional blocking acknowledgements.
- Preserve established confirmation flows for other operations unless the user asks to change them.

## Focused displays (persistent project preference)

- Keep displays focused on the user's task. Do not add unsolicited diagnostic data, technical details, status badges, refresh controls, or explanatory clutter merely because the backend exposes them.
- Add information only when it supports a clear user action or decision, or the user explicitly requests it. Preserve necessary validation and actionable errors.
- General settings should show configuration controls, not IPv6 runtime badges, refresh buttons, or raw kernel controls. Do not reintroduce these or relocate the clutter elsewhere without a user request.

## Timestamp display (persistent project preference)

- Every human-facing timestamp must use exactly `yyyy-mm-dd hh:mm:ss` in UTC. Never display fractional seconds, an ISO `T` separator, or browser-local date/time formatting.
- Reuse `formatTimestamp` from `src/services/timestamps.ts` for UI timestamps, including expanded gateway-monitor details, tables, tooltips, and diagnostic panels. Identify UTC in the surrounding label or heading.
- Preserve original timestamp formats and full precision in API/storage values, exports, machine-readable HTML `datetime` attributes, and deadline calculations. Format only at the display boundary.
- Keep explicit missing/invalid-value indicators. Add regression tests for new timestamp displays, including fractional-second input.
- See [the README timestamp convention](../README.md) and [timestamp display regression tests](../tests/component/TimestampDisplay.spec.ts).
