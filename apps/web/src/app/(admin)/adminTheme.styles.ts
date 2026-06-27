import styles1 from './adminTheme.01.module.css';
import styles2 from './adminTheme.02.module.css';
import { mergeCssModules } from '@/lib/css-modules';

const styles = mergeCssModules(styles1, styles2);

export default styles;
