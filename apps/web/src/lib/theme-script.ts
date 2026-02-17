/**
 * Inline script that runs synchronously before first paint to prevent
 * light-mode flash on page load. Injected as dangerouslySetInnerHTML in layout.tsx.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('sotto-theme')||'system';var p=window.location.pathname;if(p==='/'||p.startsWith('/auth/')||p.startsWith('/podcast/')&&p.endsWith('/embed')){document.documentElement.dataset.theme='light';return}if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})()`;
