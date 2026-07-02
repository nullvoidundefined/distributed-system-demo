import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './EventLog.module.scss';
function formatTime(ts) {
    return new Date(ts).toLocaleTimeString();
}
export function EventLog({ events }) {
    return (_jsx("section", { className: styles.log, "aria-label": "event log", "aria-live": "polite", children: _jsx("ul", { className: styles.list, children: [...events].reverse().map((event) => (_jsxs("li", { className: `${styles.row} ${styles[event.level]}`, children: [_jsx("time", { children: formatTime(event.ts) }), _jsx("span", { children: event.message })] }, event.id))) }) }));
}
