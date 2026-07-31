# Component styling

Choose the lightest layer that fits:

| Need | Use |
|------|-----|
| Runtime-calculated value (width, measured size) | inline `style` |
| Stable layout, hover, pseudo-elements, repeated rules | co-located `index.scss` with BEM root class |
| Ant Design appearance | `ConfigProvider` tokens and component props |
| App-wide reset, scrollbar, keyframes | `src/index.css` |

Component SCSS should use `--nexo-*` CSS variables from `applyThemeCssVars`, not hard-coded theme colors.
