import interLicense from '../assets/font-library/inter-OFL.txt?raw';
import loraLicense from '../assets/font-library/lora-OFL.txt?raw';
import oswaldLicense from '../assets/font-library/oswald-OFL.txt?raw';
import nunitoLicense from '../assets/font-library/nunito-OFL.txt?raw';
export interface LibraryFont {
  id: string;
  family: string;
  category: 'Sans serif' | 'Serif' | 'Display';
  weight: string;
  url: string;
  filename: string;
  licenseText: string;
  licenseUrl: string;
  pairings: string[];
}
const upstream =
  'https://github.com/google/fonts/blob/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl';
export const FONT_LIBRARY: readonly LibraryFont[] = [
  {
    id: 'inter',
    family: 'Inter',
    category: 'Sans serif',
    weight: '100 900',
    url: new URL('../assets/font-library/inter.ttf', import.meta.url).href,
    filename: 'inter.ttf',
    licenseText: interLicense,
    licenseUrl: `${upstream}/inter/OFL.txt`,
    pairings: ['Lora', 'Oswald'],
  },
  {
    id: 'lora',
    family: 'Lora',
    category: 'Serif',
    weight: '400 700',
    url: new URL('../assets/font-library/lora.ttf', import.meta.url).href,
    filename: 'lora.ttf',
    licenseText: loraLicense,
    licenseUrl: `${upstream}/lora/OFL.txt`,
    pairings: ['Inter', 'Nunito'],
  },
  {
    id: 'oswald',
    family: 'Oswald',
    category: 'Display',
    weight: '200 700',
    url: new URL('../assets/font-library/oswald.ttf', import.meta.url).href,
    filename: 'oswald.ttf',
    licenseText: oswaldLicense,
    licenseUrl: `${upstream}/oswald/OFL.txt`,
    pairings: ['Inter', 'Lora'],
  },
  {
    id: 'nunito',
    family: 'Nunito',
    category: 'Sans serif',
    weight: '200 1000',
    url: new URL('../assets/font-library/nunito.ttf', import.meta.url).href,
    filename: 'nunito.ttf',
    licenseText: nunitoLicense,
    licenseUrl: `${upstream}/nunito/OFL.txt`,
    pairings: ['Lora', 'Oswald'],
  },
];
