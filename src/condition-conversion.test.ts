import { expect,it,vi } from 'vitest'
import { ProductService } from '../electron/product-service'
it('converts one identified NEW unit through the supported photo-backed API, never the retired adjustment route',async()=>{
 const authenticatedFetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:9,legoProductId:2,condition:'USED_LIKE_NEW',originalPrice:'15',salePrice:null,currentStock:1,usedLifecycle:'AVAILABLE',damageDescription:'Cosmetic packaging damage'})))
 const service=new ProductService({authenticatedFetch})
 const photo={bytes:Uint8Array.from([137,80,78,71,13,10,26,10]),filename:'unit.png',mimeType:'image/png' as const}
 await service.createUsedOffer(2,{sourceNewListingId:4,salePrice:15,damageDescription:'Cosmetic packaging damage',reasonNote:'Actual unit inspected for packaging damage',conditionPhotos:[photo]})
 expect(authenticatedFetch.mock.calls[0][0]).toBe('/inventory/condition-conversions/2')
 const body=authenticatedFetch.mock.calls[0][1].body as FormData
 expect(body.get('sourceNewListingId')).toBe('4');expect(body.get('reason')).toBe('PACKAGING_DAMAGE')
 expect(body.getAll('conditionPhotos')).toHaveLength(1)
 await expect(service.createUsedOffer(2,{sourceNewListingId:0,salePrice:15,damageDescription:'Packaging damage',reasonNote:'Actual inspected unit',conditionPhotos:[photo]})).rejects.toThrow()
 expect(authenticatedFetch).toHaveBeenCalledTimes(1)
})
