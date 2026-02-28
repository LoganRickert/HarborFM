/// <reference types="vite/client" />

interface CSSModuleClasses {
  readonly [key: string]: string;
}

declare module "*.module.css" {
  const classes: CSSModuleClasses;
  export default classes;
}
