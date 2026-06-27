type CssModule = Record<string, string>;

export function mergeCssModules(...modules: CssModule[]): CssModule {
  const merged: CssModule = {};

  for (const moduleStyles of modules) {
    for (const [key, value] of Object.entries(moduleStyles)) {
      if (!value) continue;
      merged[key] = merged[key] ? `${merged[key]} ${value}` : value;
    }
  }

  return merged;
}
