import type { ImgHTMLAttributes, ReactElement } from "react";

import MDXComponents from "@theme-original/MDXComponents";

/**
 * TypeDoc / leftover README markdown can emit `<Image>` (capital I).
 * MDX then looks up a component that Docusaurus never provides.
 */
const Image = (props: ImgHTMLAttributes<HTMLImageElement>): ReactElement => (
  <img {...props} />
);

export default {
  ...MDXComponents,
  Image,
};
