import { FixedArray } from "./FixedArray";

export namespace Serializer
{
	const INDEX = Symbol("INDEX");

	export type Index<T extends TypeInfo> = Immutable<{
		index: number;
		type: Serializable<T>;
	}>;

	type PrimitiveInfo = {
		_parse: Parser;
		_serialize: Serializer;
		size: number;
	}

	type Parser = (view: DataView, offset: number) => any;
	type Serializer = (view: DataView, offset: number, value: any) => any;

	type ObjectParser<T extends TypeInfo> = (buffer: ArrayBuffer, offset?: number) => T;
	type ObjectSerializer<T extends TypeInfo> = (buffer: ArrayBuffer, obj: T, offset?: number) => any;

	type Prop = PropInfo & {
		name: string;
	};

	type PrimitiveType = keyof typeof primitiveTypes;

	export type TypeInfo = {
		[key: string]: boolean | number | FixedArray<any, any> | TypeInfo;
	};

	type TypeLayout<T extends TypeInfo> = {
		[K in keyof T]:
		T[K] extends number ? PrimitiveType :
		T[K] extends FixedArray<infer AT, infer S> ?
		[AT extends number ? PrimitiveType : AT extends TypeInfo ? Index<AT> : never, S] :
		T[K] extends TypeInfo ? Index<T[K]> :
		T[K] extends boolean ? "bool" :
		never;
	};

	type Serializable<T extends TypeInfo> = Immutable<{
		[INDEX]: number;
		serialize: ObjectSerializer<T>;
		parse: ObjectParser<T>;
		props: ReadonlyArray<Prop>;
		size: number;
	}>;

	type PropInfo = { size: number, offset: number, _parse: Parser, _serialize: Serializer };

	const primitiveTypes = {
		u8: {
			_serialize: (view: DataView, offset: number, value: any) => view.setUint8(offset, value),
			_parse: (view: DataView, offset: number) => view.getUint8(offset),
			size: 1
		},
		i8: {
			_serialize: (view: DataView, offset: number, value: any) => view.setInt8(offset, value),
			_parse: (view: DataView, offset: number) => view.getInt8(offset),
			size: 1
		},
		u16: {
			_serialize: (view: DataView, offset: number, value: any) => view.setUint16(offset, value),
			_parse: (view: DataView, offset: number) => view.getUint16(offset),
			size: 2
		},
		i16: {
			_serialize: (view: DataView, offset: number, value: any) => view.setInt16(offset, value),
			_parse: (view: DataView, offset: number) => view.getInt16(offset),
			size: 2
		},
		u32: {
			_serialize: (view: DataView, offset: number, value: any) => view.setUint32(offset, value),
			_parse: (view: DataView, offset: number) => view.getUint32(offset),
			size: 4
		},
		i32: {
			_serialize: (view: DataView, offset: number, value: any) => view.setInt32(offset, value),
			_parse: (view: DataView, offset: number) => view.getInt32(offset),
			size: 4
		},
		f32: {
			_serialize: (view: DataView, offset: number, value: any) => view.setFloat32(offset, value),
			_parse: (view: DataView, offset: number) => view.getFloat32(offset),
			size: 4
		},
		f64: {
			_serialize: (view: DataView, offset: number, value: any) => view.setFloat64(offset, value),
			_parse: (view: DataView, offset: number) => view.getFloat64(offset),
			size: 8
		},
		bool: {
			_serialize: (view: DataView, offset: number, value: any) => view.setUint8(offset, value),
			_parse: (view: DataView, offset: number) => view.getUint8(offset),
			size: 1
		}
	};

	const getPrimitiveInfo = (key: any): PrimitiveInfo => (primitiveTypes as any)[key];

	const getPropInfo = <T extends TypeInfo>(prop: TypeLayout<T>[string], offset: number): [PropInfo, number] =>
	{
		if (Array.isArray(prop))
		{
			const [type, size] = prop;
			const info = getPropInfo(type, offset);
			const propSize = info[0].size;
			info[0].size *= size;
			return [{
				...info[0],
				_parse: (view, innerOffset) =>
				{
					let data = new FixedArray(size);
					for (let i = 0; i < size; i++)
						data.set(i, info[0]._parse(view, innerOffset + (i * propSize)));
					return data;
				},
				_serialize: (view, innerOffset, arr: FixedArray<any, any>) =>
				{
					for (let i = 0; i < size; i++)
						info[0]._serialize(view, innerOffset + (i * propSize), arr.at(i));
				},
			}, offset + info[0].size];
		}
		else
		{
			switch (typeof prop)
			{
				case "string":
					const info = getPrimitiveInfo(prop);
					return [{ ...info, offset } as any, offset + info.size];
				case "object":
					{
						if (prop.index === undefined)
							throw new Error("Given value is not serializable!");
						const o = getSerializable(prop);
						return [{ ...o, offset } as any, offset + o.size];
					}
			}
		}
	}

	const parseLayout = <T extends TypeInfo>(info: TypeLayout<T>): [Prop[], number] =>
	{
		let totalSize = 0;

		const props: Prop[] = Object.keys(info).map((name) => 
		{
			const prop = info[name];
			const [propInfo, newSize] = getPropInfo(prop, totalSize);
			totalSize = newSize;
			return {
				...propInfo,
				name
			};
		});

		return [props, totalSize];
	}

	const registeredTypes: Serializable<any>[] = [];
	const typeLayouts: TypeLayout<any>[] = [];

	export const getRegisteredLayouts = (): ReadonlyArray<TypeLayout<any>> => typeLayouts;

	export const createType = <T extends TypeInfo>(info: TypeLayout<T>, name?: string): Index<T> =>
	{
		const [props, size] = parseLayout(info);

		const index = registeredTypes.length;

		const type = Object.seal(Object.freeze({
			name: name || `undefined-${index}`,
			[INDEX]: index,
			props,
			_parse: (view: DataView, offset: number) => 
			{
				let o: any = {};

				for (const prop of props)
					o[prop.name] = prop._parse(view, offset + prop.offset);

				return o;
			},
			_serialize: (view: DataView, offset: number, data: any) => 
			{
				for (const prop of props)
					prop._serialize(view, offset + prop.offset, data[prop.name]);
			},
			parse: <T extends TypeInfo>(buffer: ArrayBuffer, offset: number = 0): T => 
			{
				return (type as any)._parse(new DataView(buffer, offset, type.size), 0);
			},
			serialize: <T extends TypeInfo>(buffer: ArrayBuffer, obj: T, offset: number = 0) => 
			{
				const view = new DataView(buffer, offset, type.size);
				(type as any)._serialize(view, 0, obj);
			},
			size
		})) as Serializable<T>;

		registeredTypes.push(type);
		typeLayouts.push(JSON.parse(JSON.stringify(info)));

		return { index, type } as any;
	}

	export const createBuffer = <T extends TypeInfo, Shared extends boolean>(type: Serializable<T>, count: number = 1, shared?: Shared): Shared extends true ? SharedArrayBuffer : ArrayBuffer => new (shared ? SharedArrayBuffer : ArrayBuffer)(type.size * count) as any;

	export const getSerializable = <T extends TypeInfo>(index: Index<T>): Serializable<T> => registeredTypes[index.index as any];
}
