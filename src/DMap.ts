import Dexie, { IndexableType } from 'dexie'

export interface DMapConfig<V> {
    // 数据库名字
    name: string
    // 拆分value
    split?: (input: V) => any[]
    // 合并value
    join?: (...input: any[]) => V
}

export default class DMap<K extends IndexableType, V> {
    private config: DMapConfig<V>
    private db: Dexie
    private keyTable: Dexie.Table<any, string>
    private valueTable: Dexie.Table<any, string>

    private valueTables: Dexie.Table<any, string>[]
    private valueTableCount: number
    private valueTablePointer: number

    private allTables: Dexie.Table<any, string>[]

    constructor(config: DMapConfig<V>) {
        // super()

        if (!config.name) {
            throw new Error('DMap: config.name is required!')
        }
        if (!config.split) {
            config.split = i => [i]
        }
        if (!config.join) {
            config.join = i => i[0]
        }
        this.config = config

        this.db = new Dexie(this.config.name)
        this.db.version(1).stores({
            key: '++id,key,frags',
            value: '++id,fragID,data',
            value1: '++id,fragID,data',
            value2: '++id,fragID,data',
            value3: '++id,fragID,data',
        })

        this.keyTable = this.db.table('key')
        this.valueTable = this.db.table('value')

        this.valueTables = [
            this.db.table('value'),
            this.db.table('value1'),
            this.db.table('value2'),
            this.db.table('value3'),
        ]

        this.valueTableCount = 4
        this.valueTablePointer = 0

        this.allTables = [
            this.db.table('key'),
            this.db.table('value'),
            this.db.table('value1'),
            this.db.table('value2'),
            this.db.table('value3'),
        ]
    }

    /**
     *
     * @param key
     * @param value
     */
    async set(key: K, value: V): Promise<DMap<K, V>> {
        if (value === undefined && value === null)
            throw new Error('DMap: Value can not be undefined or null.')

        const fragments = this.config.split(value)

        await this.db.transaction('rw', this.allTables, async () => {
            // 避免键冲突

            const collection = await this.keyTable.where('key').equals(key)
            const obj = await collection.first()

            if (obj) {
                console.log('key conflict', key)
                await this.delete(key)
            }

            // 写入新数据
            const promises = []
            const frags = []
            for (let i = 0; i < fragments.length; i++) {
                const data = fragments[i]
                const fragID = `${key}-${i}`
                frags.push([this.valueTablePointer, fragID])
                promises.push(this.valueTables[this.valueTablePointer].add({ fragID, data }))
                this.valueTablePointer++
                if (this.valueTablePointer >= this.valueTableCount) {
                    this.valueTablePointer = 0
                }
            }

            await Dexie.Promise.all(promises)

            // 写入key

            await this.keyTable.add({ key, frags })
        })

        return this
    }

    /**
     *
     * @param key
     */
    async delete(key: K): Promise<boolean> {
        return await this.db.transaction('rw', this.allTables, async () => {
            const collection = await this.keyTable.where('key').equals(key)

            const curr = await collection.first()

            if (!curr) {
                console.log('key not found', key)
                return false
            }

            const frags = []
            curr.frags.forEach(([pointer, fragID]) => {
                if (!frags[pointer]) {
                    frags[pointer] = []
                }

                frags[pointer].push(fragID)
            })

            const promises = []
            for (let pointer = 0; pointer < frags.length; pointer++) {
                const fragIDs = frags[pointer]
                if (fragIDs) {
                    promises.push(
                        this.valueTables[pointer]
                            .where('fragID')
                            .anyOf(fragIDs)
                            .delete()
                    )
                }
            }

            await Dexie.Promise.all(promises)

            // 删除key
            await collection.delete()

            return true
        })
    }

    async get(key: K): Promise<V> {
        const frags = await this.db.transaction('r', this.allTables, async () => {
            const collection = await this.keyTable.where('key').equals(key)

            const objs = await collection.toArray()

            if (objs.length === 0) {
                console.log('key not found', key)
                return null
            } else if (objs.length > 1) {
                throw new Error('DMap: 数据表键冲突')
            } else {
                const fragIDs = objs[0].frags
                const frags = []
                const promises = []

                for (let i = 0; i < fragIDs.length; i++) {
                    promises.push(
                        this.valueTables[fragIDs[i][0]]
                            .where('fragID')
                            .equals(fragIDs[i][1])
                            .toArray()
                    )
                }

                const objss = await Dexie.Promise.all(promises)

                for (let i = 0; i < fragIDs.length; i++) {
                    const objs = objss[i]

                    if (objs.length === 0) {
                        throw new Error('key not found: ' + key)
                    } else if (objs.length > 1) {
                        throw new Error('DMap: 数据表键冲突')
                    } else {
                        frags.push(objs[0].data)
                    }
                }
                return frags
            }
        })

        return frags ? this.config.join(frags) : null
    }

    async clear() {
        for (let i = 0; i < this.valueTableCount; i++) {
            await this.valueTableCount[i].clear()
        }
        await this.keyTable.clear()
        // await this.valueTable.clear()
    }
}
