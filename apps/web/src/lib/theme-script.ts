/**
 * Inline script that runs synchronously before first paint to prevent
 * light-mode flash on page load. Injected as dangerouslySetInnerHTML in layout.tsx.
 * Also reads 'sotto-accent' → sets --user-accent, and 'sotto-palette' → sets dataset.palette.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('sotto-theme')||'system';var p=window.location.pathname;if(p==='/'||p.startsWith('/auth/')||p.startsWith('/episode/')&&p.endsWith('/embed')){document.documentElement.dataset.theme='light'}else{if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}var a=localStorage.getItem('sotto-accent');if(a){document.documentElement.style.setProperty('--user-accent',a)}var pal=localStorage.getItem('sotto-palette');document.documentElement.dataset.palette=pal&&(pal==='aula'||pal==='paper')?pal:'aula'}catch(e){document.documentElement.dataset.theme='light';document.documentElement.dataset.palette='aula'}})()`;
