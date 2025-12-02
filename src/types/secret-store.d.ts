declare module '../db/secret-store.cjs' {
  const ns: any;
  export = ns;
}

declare module 'electron/db/secret-store.cjs' {
  const ns: any;
  export = ns;
}

declare module '*secret-store.cjs' {
  const ns: any;
  export = ns;
}
