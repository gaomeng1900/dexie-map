const G = typeof window !== 'undefined' ? window : self

import DMap from '../src/DMap.ts'
import download from 'js-file-download'

G.DMap = DMap
G.download = download
