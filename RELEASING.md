# Releasing Guide

## Versioning Policy

This project uses Semantic Versioning.

- MAJOR: Breaking API or behavior changes
- MINOR: Backward-compatible features
- PATCH: Backward-compatible bug fixes

Until v1.0.0, breaking changes may happen in minor versions and will be clearly stated in release notes.

## Release Note Policy

- Keep release notes in CHANGELOG.md
- Add one entry per release under Unreleased -> released version
- Include at least:
  - Added
  - Changed
  - Fixed
  - Known limitations (if any)

## Release Steps

1. Confirm CI is green for the target commit.
2. Update CHANGELOG.md from Unreleased.
3. Decide next version following VERSIONING policy above.
4. Create Git tag:
   - vX.Y.Z
5. Create GitHub Release from the tag.
6. Copy CHANGELOG entries into release description.

## Beta Constraints (must be repeated in release notes)

- Single-user local beta
- No authentication/authorization
- Not intended for production use
