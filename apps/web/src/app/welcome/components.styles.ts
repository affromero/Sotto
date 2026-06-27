import styles1 from './components.01.module.css';
import styles2 from './components.02.module.css';
import styles3 from './components.03.module.css';
import { mergeCssModules } from '@/lib/css-modules';

const styles = mergeCssModules(styles1, styles2, styles3);

export default styles;
