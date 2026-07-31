# frontend-component-styling Specification

## Purpose
TBD - created by archiving change flexible-component-styling. Update Purpose after archive.
## Requirements
### Requirement: Component styles use the appropriate layer
The frontend SHALL choose a styling layer based on the nature of the style instead of applying inline `style` to all presentation concerns by default.

#### Scenario: Dynamic runtime value
- **WHEN** a visual property depends on runtime-calculated values such as drag width, measured height, or scroll position
- **THEN** the component MAY use inline `style` for that property
- **AND** it SHALL NOT move that dynamic value into SCSS

#### Scenario: Stable reusable presentation
- **WHEN** a component defines stable layout, spacing, typography, hover, focus, or pseudo-element styles that do not depend on per-render calculations
- **THEN** the component SHALL place those styles in a co-located component SCSS file
- **AND** the JSX SHALL reference those styles through `className` instead of large inline style objects

#### Scenario: Ant Design component theming
- **WHEN** a visual concern is already covered by Ant Design tokens or component props
- **THEN** the frontend SHALL prefer `ConfigProvider` tokens and Ant Design props over custom inline styles or duplicate SCSS

### Requirement: Co-located component SCSS files
Complex frontend components SHALL keep their static styles in a SCSS file located in the same component directory.

#### Scenario: Layout shell component
- **WHEN** a component such as the application layout shell defines navigation, panel containers, or repeated icon-button presentation
- **THEN** it SHALL import a co-located SCSS file from the same directory
- **AND** the SCSS file SHALL use a component-scoped BEM-style root block class to avoid global leakage

#### Scenario: New component with substantial styling
- **WHEN** a new component is expected to contain more than a few one-off visual rules
- **THEN** the author SHALL create the component SCSS file at implementation time
- **AND** SHALL NOT accumulate large static style objects inside JSX

### Requirement: Theme-aware SCSS uses CSS variables
Component SCSS SHALL consume the existing Nexo theme through CSS custom properties instead of hard-coded theme colors.

#### Scenario: Dark and light theme switch
- **WHEN** the user toggles theme mode
- **THEN** component SCSS that references `--nexo-*` variables SHALL update appearance without component remount-specific color rewrites
- **AND** SCSS SHALL NOT hard-code separate dark and light color palettes for values already exposed as theme variables

#### Scenario: Missing theme token
- **WHEN** a migrated component needs a theme color that is not yet exposed as a CSS variable
- **THEN** the theme system SHALL add the missing `--nexo-*` mapping before the component SCSS relies on it

### Requirement: Global styles remain minimal
The frontend SHALL keep only cross-cutting global styles in `src/index.css`.

#### Scenario: Global reset and scrollbar
- **WHEN** a style applies to the entire application shell such as body reset, root sizing, or scrollbar styling
- **THEN** it SHALL remain in `src/index.css`
- **AND** it SHALL NOT be duplicated inside component SCSS files

#### Scenario: Component-specific styling
- **WHEN** a style applies to one component or one feature area
- **THEN** it SHALL NOT be added to `src/index.css`
- **AND** it SHALL live in that component's co-located SCSS file

### Requirement: Incremental migration preserves behavior
Existing components SHALL migrate from inline-only styling to the layered approach incrementally without changing user-visible behavior.

#### Scenario: High-complexity component migration
- **WHEN** a high-complexity component such as `AppLayout`, `ChatPanel`, or `Settings` is migrated
- **THEN** the migration SHALL extract static and repeated styles into SCSS first
- **AND** SHALL preserve existing layout, spacing, colors, and interaction behavior

#### Scenario: Low-touch component not yet migrated
- **WHEN** a component has not yet been migrated
- **THEN** it MAY temporarily keep existing inline styles
- **AND** new edits to that component SHALL follow the layered styling rules for touched code

### Requirement: SCSS build support is available
The web frontend build SHALL support importing SCSS files through the existing Vite pipeline.

#### Scenario: Component imports SCSS
- **WHEN** a component imports `./index.scss` or another co-located SCSS file
- **THEN** `npm run build` SHALL compile the stylesheet successfully
- **AND** the compiled styles SHALL be included in the production bundle

#### Scenario: Developer workflow
- **WHEN** a developer runs the web dev server
- **THEN** SCSS changes SHALL hot reload or rebuild without requiring a custom preprocessor setup beyond the project dependency list
