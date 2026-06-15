/**
 * Inline script that runs synchronously before first paint to apply the active
 * profile's appearance with no flash. Injected as dangerouslySetInnerHTML in
 * layout.tsx.
 *
 * Source of truth order: the readable `sotto_theme` cookie (the active profile's
 * prefs, set by the switch route / appearance PATCH) wins and is mirrored into
 * localStorage so the React ThemeProvider reads the right values; otherwise it
 * falls back to localStorage. Applies data-theme (resolving `system`), the light
 * palette, the accent custom property, and data-reduced-motion.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var ck=null;var m=document.cookie.match(/(?:^|;\\s*)sotto_theme=([^;]+)/);if(m){try{ck=JSON.parse(decodeURIComponent(m[1]))}catch(e){ck=null}}if(ck){if(ck.mode)localStorage.setItem('sotto-theme',ck.mode);if(ck.palette)localStorage.setItem('sotto-palette',ck.palette);if(ck.accent){localStorage.setItem('sotto-accent',ck.accent)}else{localStorage.removeItem('sotto-accent')}localStorage.setItem('sotto-motion',ck.reducedMotion?'reduce':'auto')}var t=(ck&&ck.mode)||localStorage.getItem('sotto-theme')||'system';var p=window.location.pathname;if(p==='/'||p.startsWith('/auth/')||(p.startsWith('/episode/')&&p.endsWith('/embed'))){d.dataset.theme='light'}else{if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.dataset.theme=t}var pal=(ck&&ck.palette)||localStorage.getItem('sotto-palette');d.dataset.palette=pal&&(pal==='aula'||pal==='paper')?pal:'aula';var a=(ck&&ck.accent)||localStorage.getItem('sotto-accent');if(a){d.style.setProperty('--user-accent',a)}var rm=ck?!!ck.reducedMotion:(localStorage.getItem('sotto-motion')==='reduce');if(rm){d.dataset.reducedMotion='reduce'}else{d.removeAttribute('data-reduced-motion')}}catch(e){document.documentElement.dataset.theme='light';document.documentElement.dataset.palette='aula'}})()`;
