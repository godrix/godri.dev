<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Verificação antes de finalizar

Depois de alterar código neste repositório, **sempre** rode:

```bash
npm run lint
npm run build
```

Ou o atalho:

```bash
npm run verify
```

Não considere a tarefa concluída se lint ou build falharem. Corrija os erros (especialmente TypeScript) antes de commitar ou pedir deploy.

O hook `pre-push` em `.githooks/` bloqueia `git push` quando o build quebra (mesma checagem da Vercel).
