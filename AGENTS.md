<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This project runs **Next.js 15.5** with the App Router, Turbopack in development, and React 19. APIs, conventions and file structure may differ from your training data. Verify before writing framework code instead of recalling it.

Where the truth is, in order:

1. **The installed package.** `node_modules/next/package.json` gives the exact version; the type definitions under `node_modules/next/dist/**/*.d.ts` are the contract this build actually enforces. A signature you remember and a signature the compiler accepts are not the same thing.
2. **The official docs for that exact version**, at nextjs.org/docs.
3. **The code around you.** Match the conventions of the files you are editing.

There is no `node_modules/next/dist/docs/` directory — an earlier version of this file told every agent to read it, and sent them looking for something that does not ship with this package.

Heed deprecation notices: a warning in the build output is a breaking change with a date on it.
<!-- END:nextjs-agent-rules -->
