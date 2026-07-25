## What

<!-- Brief description of the change -->

## Why

<!-- Why is this change needed? Link to issue if applicable -->

## Checklist

- [ ] Backend tests pass (`uv run pytest tests/ -v`)
- [ ] Static checks pass (`uv run pre-commit run --all-files`)
- [ ] Frontend checks pass (`cd frontend && bun run test && bun run typecheck && bun run lint && bun run format:check && bun run build`)
- [ ] New strings added to `en.json`, `de.json`, and `zh-Hans.json` (if applicable)
- [ ] Tested on mobile layout (if UI change)
