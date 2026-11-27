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

## Jogo Cataratas (`public/cataratas`)

`public/cataratas/` é **gerado** pelo projeto `cataratas-no-barril` (Capacitor, em
`~/Documents/projects/capacitor/cataratas-no-barril`, pasta `game/`) com `npm run publish:web`.
Não edite o jogo aqui: as mudanças seriam apagadas na próxima publicação.

`public/cataratas-demo/` é a demo jogável do mesmo jogo (uma descida até 800 m), também **gerada**
por lá, com `npm run publish:demo`. Os rewrites de `/cataratas` e `/cataratas-demo` ficam em
`next.config.ts`.
