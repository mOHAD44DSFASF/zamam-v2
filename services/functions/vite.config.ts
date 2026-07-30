import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'
const nodeBuiltins=[...builtinModules,...builtinModules.map(name=>`node:${name}`)]
export default defineConfig({
  build:{
    ssr:true,
    target:'node22',
    outDir:'deploy-dist',
    emptyOutDir:true,
    lib:{entry:'src/index.ts',formats:['es'],fileName:'index'},
    rollupOptions:{external:[...nodeBuiltins,/^firebase-admin(?:\/.*)?$/,/^firebase-functions(?:\/.*)?$/]},
  },
  ssr:{noExternal:[/^@zamam\//,'zod']},
})
