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

    constructor(config: DMapConfig<V>) {
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
            key: 'key', // key:string -> fragIDs: fragID[]
            value: 'fragID', // fragID:string -> any
        })

        this.keyTable = this.db.table('key')
        this.valueTable = this.db.table('value')
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

            // primary key
            const obj = await this.keyTable
                .where('key')
                .equals(key)
                .first()

            if (obj) {
                console.log('key conflict', key)
                await this.delete(key)
            }

            // 写入新数据
            const promises = []
            const fragIDs = []
            const values = []
            for (let i = 0; i < fragments.length; i++) {
                const data = fragments[i]
                // @todo 不应该假设 key 可以表示成字符串，这里应该直接递增
                const fragID = `${key}-${i}`
                fragIDs.push(fragID)
                values.push({ fragID, data })
            }

            await this.valueTable.bulkAdd(values)

            // 写入key

            await this.keyTable.add({ key, fragIDs })
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

            const obj = await collection.first()

            if (!obj) {
                console.log('key not found', key)
                return false
            }

            await this.valueTable.bulkDelete(obj.fragIDs)
            // await this.valueTable
            //     .where('fragID')
            //     .anyOf(obj.fragIDs)
            //     .delete()

            // 删除key
            await collection.delete()

            return true
        })
    }

    /**
     *
     * @param key
     */
    async get(key: K): Promise<V> {
        const frags = await this.db.transaction('r', [this.keyTable, this.valueTable], async () => {
            // 主键理论上不可能冲突
            const obj = await this.keyTable
                .where('key')
                .equals(key)
                .first()

            if (!obj) {
                console.log('key not found', key)
                return null
            } else {
                const fragIDs = obj.fragIDs
                const frags = []

                // 找到所有需要的分片
                const _objs = await this.valueTable
                    .where('fragID')
                    .anyOf(fragIDs)
                    .toArray()

                // 检测分片完整性
                const objs = _objs.filter(obj => !!obj)
                if (objs.length < _objs.length) {
                    console.error('数据段分片不完整，可能是被浏览器清除，或者之前写入是发生崩溃')
                    return null
                }

                // 分片排序
                for (let i = 0; i < fragIDs.length; i++) {
                    const fragID = fragIDs[i]
                    const frag = objs.find(value => value.fragID === fragID)
                    frags.push(frag.data)
                }

                return frags
            }
        })

        return frags ? this.config.join(frags) : null
    }

    /**
     *
     * @param key
     */
    async has(key: K) {
        const obj = await this.keyTable
            .where('key')
            .equals(key)
            .first()

        if (!obj) {
            console.log('key not found', key)
            return false
        } else {
            return true
        }
    }

    /**
     *
     */
    async clear() {
        await this.keyTable.clear()
        await this.valueTable.clear()
    }

    /**
     *
     */
    close() {
        this.db.close()
    }

    /**
     *
     */
    get size() {
        return (async () => {
            return await this.keyTable.count()
        })()
    }

    // @todo

    forEach(func) {}
    entries() {}
    keys() {}
    values() {}
}
