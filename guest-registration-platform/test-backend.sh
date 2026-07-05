#!/usr/bin/env bash
set -euo pipefail

echo "== Guest Registration Backend Test =="

echo ""
echo "1) Install deps if needed"
pnpm install

echo ""
echo "2) Generate Prisma client"
pnpm --filter @gr/db prisma generate

echo ""
echo "3) Apply local database migrations"
pnpm --filter @gr/db prisma migrate dev

echo ""
echo "4) Run shared validation/domain tests"
pnpm --filter @gr/shared test

echo ""
echo "5) Run API tests"
pnpm --filter @gr/api test

echo ""
echo "6) Run worker tests"
pnpm --filter @gr/worker test

echo ""
echo "7) Run PDF package tests"
pnpm --filter @gr/pdf test

echo ""
echo "8) Typecheck backend-related packages"
pnpm --filter @gr/shared typecheck
pnpm --filter @gr/db typecheck
pnpm --filter @gr/api typecheck
pnpm --filter @gr/worker typecheck
pnpm --filter @gr/pdf typecheck

echo ""
echo "✅ Backend tests passed"
