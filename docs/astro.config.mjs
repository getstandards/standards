// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://getstandards.dev',
	integrations: [
		starlight({
			title: 'Standards',
			description:
				'Your engineering standards, written once and enforced everywhere.',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/getstandards/standards',
				},
			],
			sidebar: [],
		}),
	],
});