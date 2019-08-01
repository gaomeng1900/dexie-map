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

        await this.db.transaction('rw', [this.keyTable, this.valueTable], async () => {
            // 避免键冲突

            const collection = await this.keyTable.where('key').equals(key)
            const obj = await collection.first()

            if (obj) {
                console.log('key conflict', key)
                await this.delete(key)
            }

            // 写入新数据
            const frags = []
            for (let i = 0; i < fragments.length; i++) {
                const data = fragments[i]
                const fragID = `${key}-${i}`
                frags.push([fragID])
                await this.valueTable.add({ fragID, data })
            }

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
        return await this.db.transaction('rw', [this.keyTable, this.valueTable], async () => {
            const collection = await this.keyTable.where('key').equals(key)

            const curr = await collection.first()

            if (!curr) {
                console.log('key not found', key)
                return false
            }

            // 删除value
            // const values = this.valueTable.where
            // await Dexie.Promise.all(
            //     curr.frags.map(fragID => this.valueTable.delete({ fragID: fragID }))
            // )
            // await this.valueTable.bulkDelete(
            //     curr.frags.map(fragID => {
            //         return { fragID }
            //     })
            // )
            await this.valueTable
                .where('fragID')
                .anyOf(curr.frags)
                .delete()

            // 删除key
            await collection.delete()

            return true
        })
    }

    async get(key: K): Promise<V> {
        const frags = await this.db.transaction('r', [this.keyTable, this.valueTable], async () => {
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
                for (let i = 0; i < fragIDs.length; i++) {
                    const objs = await this.valueTable
                        .where('fragID')
                        .equals(fragIDs[i])
                        .toArray()
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
        await this.keyTable.clear()
        await this.valueTable.clear()
    }
}
