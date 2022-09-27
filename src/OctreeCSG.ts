import { checkTrianglesIntersection } from './three-triangle-intersection.js';
import { Polygon, PolygonState } from './math/Polygon.js';
import { Box3, Matrix3, Matrix4, Ray, Vector3 } from 'threejs-math';
import Plane from './math/Plane.js';
import Vertex from './math/Vertex.js';
import Triangle from './math/Triangle';
import { tmpm3, tv0 } from './temp.js';
import { polyInside_WindingNumber_buffer, _wP_EPS_ARR, _wP_EPS_ARR_COUNT } from './common.js';

const _v1 = new Vector3();
const _v2 = new Vector3();
const _box3$1 = new Box3();

const _ray = new Ray();
const _rayDirection = new Vector3(0, 0, 1);

const EPSILON = 1e-5;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

// working values for rayIntersectsTriangle static method
const edge1 = new Vector3();
const edge2 = new Vector3();
const h = new Vector3();
const s = new Vector3();
const q = new Vector3();
const RAY_EPSILON = 0.0000001;

interface RayIntersect {
    distance: number,
    polygon: Polygon,
    position: Vector3
}

interface OctreeCSGObject {
    op: 'union' | 'subtract' | 'intersect',
    objA: OctreeCSG | OctreeCSGObject,
    objB: OctreeCSG | OctreeCSGObject
}

class OctreeCSG {
    polygons: Polygon[];
    replacedPolygons: Polygon[];
    box?: Box3;
    subTrees: OctreeCSG[];
    parent: OctreeCSG | null;
    level: number;
    polygonArrays: Polygon[][];
    bounds?: Box3;

    static disposeOctree = true;
    static useWindingNumber = false;
    static maxLevel = 16;
    static polygonsPerTree = 100;

    constructor(box?: Box3, parent: OctreeCSG | null = null) {
        this.polygons = [];
        this.replacedPolygons = [];
        this.box = box;
        this.subTrees = [];
        this.parent = parent;
        this.level = 0;
        this.polygonArrays = [];
        this.addPolygonsArrayToRoot(this.polygons);
    }

    clone() {
        return new OctreeCSG().copy(this);
    }

    copy(source: OctreeCSG) {
        this.deletePolygonsArrayFromRoot(this.polygons);
        this.polygons = source.polygons.map(p => p.clone());
        this.addPolygonsArrayToRoot(this.polygons);

        this.replacedPolygons = source.replacedPolygons.map(p => p.clone());

        this.box = source.box?.clone();
        this.level = source.level;

        for (let i = 0; i < source.subTrees.length; i++) {
            let subTree = new OctreeCSG(undefined, this).copy(source.subTrees[i]);
            this.subTrees.push(subTree);
        }

        return this;
    }

    addPolygonsArrayToRoot(array: Polygon[]) {
        if (this.parent) {
            this.parent.addPolygonsArrayToRoot(array);
        }
        else {
            this.polygonArrays.push(array);
        }
    }

    deletePolygonsArrayFromRoot(array: Polygon[]) {
        if (this.parent) {
            this.parent.deletePolygonsArrayFromRoot(array);
        }
        else {
            let index = this.polygonArrays.indexOf(array);

            if (index > -1) {
                this.polygonArrays.splice(index, 1);
            }
        }
    }

    isEmpty() {
        return this.polygons.length === 0;
    }

    addPolygon(polygon: Polygon, trianglesSet?: Set<string>) {
        if (!this.bounds) {
            this.bounds = new Box3();
        }

        let triangle = polygon.triangle;

        if (trianglesSet && !isUniqueTriangle(triangle, trianglesSet)) {
            return this;
        }

        this.bounds.min.x = Math.min(this.bounds.min.x, triangle.a.x, triangle.b.x, triangle.c.x);
        this.bounds.min.y = Math.min(this.bounds.min.y, triangle.a.y, triangle.b.y, triangle.c.y);
        this.bounds.min.z = Math.min(this.bounds.min.z, triangle.a.z, triangle.b.z, triangle.c.z);
        this.bounds.max.x = Math.max(this.bounds.max.x, triangle.a.x, triangle.b.x, triangle.c.x);
        this.bounds.max.y = Math.max(this.bounds.max.y, triangle.a.y, triangle.b.y, triangle.c.y);
        this.bounds.max.z = Math.max(this.bounds.max.z, triangle.a.z, triangle.b.z, triangle.c.z);

        this.polygons.push(polygon);
        return this;
    }

    calcBox() {
        if (!this.bounds) {
            this.bounds = new Box3();
        }

        this.box = this.bounds.clone();

        // offset small ammount to account for regular grid
        this.box.min.x -= 0.01;
        this.box.min.y -= 0.01;
        this.box.min.z -= 0.01;

        return this;
    }

    newOctree(box?: Box3, parent?: OctreeCSG) {
        return new OctreeCSG(box, parent);
    }

    split(level: number) {
        if (!this.box) return;

        const subTrees = [];
        const halfsize = _v2.copy(this.box.max).sub(this.box.min).multiplyScalar(0.5);
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
                for (let z = 0; z < 2; z++) {
                    const box = new Box3();
                    const v = _v1.set(x, y, z);

                    box.min.copy(this.box.min).add(v.multiply(halfsize));
                    box.max.copy(box.min).add(halfsize);
                    box.expandByScalar(EPSILON);
                    subTrees.push(this.newOctree(box, this));
                }
            }
        }

        let polygon;
        while (polygon = this.polygons.pop()) {
            let found = false;
            for (let i = 0; i < subTrees.length; i++) {
                if (subTrees[i].box?.containsPoint(polygon.getMidpoint())) {
                    subTrees[i].polygons.push(polygon);
                    found = true;
                }

            }
            if (!found) {
                console.error("ERROR: unable to find subtree for:", polygon.triangle);
                throw new Error(`Unable to find subtree for triangle at level ${level}`);
            }

        }

        for (let i = 0; i < subTrees.length; i++) {
            subTrees[i].level = level + 1;
            const len = subTrees[i].polygons.length;

            // if (len !== 0) {
            if (len > OctreeCSG.polygonsPerTree && level < OctreeCSG.maxLevel) {
                subTrees[i].split(level + 1);

            }
            this.subTrees.push(subTrees[i]);
            // }
        }

        return this;
    }

    buildTree() {
        this.calcBox();
        this.split(0);
        this.processTree();

        return this;

    }

    processTree() {
        if (!this.isEmpty() && this.box) {
            _box3$1.copy(this.box);
            for (let i = 0; i < this.polygons.length; i++) {
                this.box.expandByPoint(this.polygons[i].triangle.a);
                this.box.expandByPoint(this.polygons[i].triangle.b);
                this.box.expandByPoint(this.polygons[i].triangle.c);
            }
            this.expandParentBox();
        }

        for (let i = 0; i < this.subTrees.length; i++) {
            this.subTrees[i].processTree();
        }
    }

    expandParentBox() {
        if (this.parent) {
            if(this.box && this.parent.box) {
                this.parent.box.expandByPoint(this.box.min);
                this.parent.box.expandByPoint(this.box.max);
            }

            this.parent.expandParentBox();
        }
    }

    getPolygonsIntersectingPolygon(targetPolygon: Polygon, polygons: Polygon[] = []) {
        if (this.box?.intersectsTriangle(targetPolygon.triangle)) {
            if (this.polygons.length > 0) {
                let allPolygons = this.polygons.slice();
                if (this.replacedPolygons.length > 0) {
                    for (let i = 0; i < this.replacedPolygons.length; i++) {
                        allPolygons.push(this.replacedPolygons[i]);
                    }
                }
                for (let i = 0; i < allPolygons.length; i++) {
                    let polygon = allPolygons[i];

                    if (!polygon.originalValid || !polygon.valid || !polygon.intersects) {
                        continue;
                    }

                    if (checkTrianglesIntersection(targetPolygon.triangle, polygon.triangle)) {
                        polygons.push(polygon);
                    }
                }
            }
        }

        for (let i = 0; i < this.subTrees.length; i++) {
            this.subTrees[i].getPolygonsIntersectingPolygon(targetPolygon, polygons);
        }

        return polygons;
    }


    getRayPolygons(ray: Ray, polygons: Polygon[] = []) {
        if (this.polygons.length > 0) {
            for (let i = 0; i < this.polygons.length; i++) {
                if (this.polygons[i].valid && this.polygons[i].originalValid) {
                    if (polygons.indexOf(this.polygons[i]) === -1) {
                        polygons.push(this.polygons[i]);
                    }
                }
            }
        }
        if (this.replacedPolygons.length > 0) {
            polygons.push(...this.replacedPolygons);
        }
        for (let i = 0; i < this.subTrees.length; i++) {
            if (ray.intersectsBox(this.subTrees[i].box as Box3)) {
                this.subTrees[i].getRayPolygons(ray, polygons);
            }
        }

        return polygons;
    }

    rayIntersect(ray: Ray, intersects: RayIntersect[] = []) {
        if (ray.direction.length() === 0) return [];

        let distance = 1e100;
        let polygons = this.getRayPolygons(ray);

        for (let i = 0; i < polygons.length; i++) {
            // MollerTrumbore
            const result = OctreeCSG.rayIntersectsTriangle(ray, polygons[i].triangle, _v1);
            if (result) {
                const newdistance = result.clone().sub(ray.origin).length();
                if (distance > newdistance) {
                    distance = newdistance;
                }
                if (distance < 1e100) {
                    intersects.push({ distance: distance, polygon: polygons[i], position: result.clone().add(ray.origin) });
                }
            }
        }

        intersects.length && intersects.sort(raycastIntersectAscSort);
        return intersects;
    }

    getIntersectingPolygons(polygons: Polygon[] = []) {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                for (let i = 0; i < polygonsArray.length; i++) {
                    if (polygonsArray[i].valid && polygonsArray[i].intersects) {
                        polygons.push(polygonsArray[i]);
                    }
                }
            }
        });

        return polygons;
    }

    getPolygons(polygons: Polygon[] = []) {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                for (let i = 0; i < polygonsArray.length; i++) {
                    if (polygonsArray[i].valid) {
                        if (polygons.indexOf(polygonsArray[i]) === -1) {
                            polygons.push(polygonsArray[i]);
                        }
                    }

                }
            }
        });

        return polygons;
    }

    invert() {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                polygonsArray.forEach(p => p.flip());
            }
        });
    }

    replacePolygon(polygon: Polygon, newPolygons: Polygon[] | Polygon) {
        if (!Array.isArray(newPolygons)) {
            newPolygons = [newPolygons];
        }

        if (this.polygons.length > 0) {
            let polygonIndex = this.polygons.indexOf(polygon);
            if (polygonIndex > -1) {
                if (polygon.originalValid === true) {
                    this.replacedPolygons.push(polygon);
                }
                else {
                    polygon.setInvalid();
                }


                this.polygons.splice(polygonIndex, 1, ...newPolygons);
            }
        }

        for (let i = 0; i < this.subTrees.length; i++) {
            this.subTrees[i].replacePolygon(polygon, newPolygons);
        }
    }

    deletePolygonsByStateRules(rulesArr: CSGRulesArray, firstRun = true) {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                let polygonArr = polygonsArray.filter(polygon => (polygon.valid == true) && (polygon.intersects == true));

                polygonArr.forEach(polygon => {
                    let found = false;
                    for (let j = 0; j < rulesArr.length; j++) {
                        if (rulesArr[j].array) {
                            let states = rulesArr[j].rule as PolygonState[];
                            if ((states.includes(polygon.state)) && (((polygon.previousState !== "undecided") && (states.includes(polygon.previousState))) || (polygon.previousState == "undecided"))) {
                                found = true;
                                const missingStates = new Set<PolygonState>();
                                states.forEach(state => missingStates.add(state));
                                missingStates.delete(polygon.state);

                                for (let i = 0; i < polygon.previousStates.length; i++) {
                                    if (!states.includes(polygon.previousStates[i])) { // if previous state not one of provided states (not included in states array), break
                                        found = false;
                                        break;
                                    }
                                    else {
                                        missingStates.delete(polygon.previousStates[i]);
                                    }
                                }

                                if(missingStates.size > 0)
                                    found = false;
                                else if(found)
                                    break;
                            }
                        }
                        else {
                            if (polygon.checkAllStates(rulesArr[j].rule as PolygonState)) {
                                found = true;
                                break;
                            }
                        }
                    }

                    if (found) {
                        let polygonIndex = polygonsArray.indexOf(polygon);
                        if (polygonIndex > -1) {
                            polygon.setInvalid();
                            polygonsArray.splice(polygonIndex, 1);
                        }

                        if (firstRun) {
                            polygon.delete();
                        }
                    }
                });
            }
        });
    }

    deletePolygonsByIntersection(intersects: boolean, firstRun = true) {
        if (intersects == undefined) {
            return;
        }

        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                let polygonArr = polygonsArray.slice();
                polygonArr.forEach(polygon => {
                    if (polygon.valid) {
                        if (polygon.intersects === intersects) {
                            let polygonIndex = polygonsArray.indexOf(polygon);
                            if (polygonIndex > -1) {
                                polygon.setInvalid();
                                polygonsArray.splice(polygonIndex, 1);
                            }

                            if (firstRun) {
                                polygon.delete();
                            }
                        }
                    }
                });
            }
        });
    }

    isPolygonIntersecting(polygon: Polygon) {
        // XXX: !! is for forcing conversion from undefined to false
        return !!this.box?.intersectsTriangle(polygon.triangle);
    }

    markIntesectingPolygons(targetOctree: OctreeCSG) {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                polygonsArray.forEach(polygon => {
                    polygon.intersects = targetOctree.isPolygonIntersecting(polygon);
                });
            }
        });
    }

    resetPolygons(resetOriginal = true) {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                polygonsArray.forEach(polygon => {
                    polygon.reset(resetOriginal);
                });
            }
        });
    }

    handleIntersectingPolygons(targetOctree: OctreeCSG, targetOctreeBuffer?: Float32Array) {
        if (this.polygons.length > 0) {
            let polygonStack = this.polygons.filter(polygon => (polygon.valid == true) && (polygon.intersects == true) && (polygon.state == "undecided"));
            let currentPolygon = polygonStack.pop();

            while (currentPolygon) {
                if (currentPolygon.state !== "undecided") {
                    continue;
                }
                if (!currentPolygon.valid) {
                    continue;
                }

                let targetPolygons = targetOctree.getPolygonsIntersectingPolygon(currentPolygon);
                if (targetPolygons.length > 0) {
                    for (let j = 0; j < targetPolygons.length; j++) {
                        let target = targetPolygons[j];
                        let splitResults = splitPolygonByPlane(currentPolygon, target.plane);
                        if (splitResults.length > 1) {
                            for (let i = 0; i < splitResults.length; i++) {
                                let polygon = splitResults[i].polygon;
                                polygon.intersects = currentPolygon.intersects;
                                polygon.newPolygon = true;
                                polygonStack.push(polygon);
                            }
                            this.replacePolygon(currentPolygon, splitResults.map(result => result.polygon));
                            break;
                        }
                        else {
                            if (currentPolygon.id !== splitResults[0].polygon.id) {
                                splitResults[0].polygon.intersects = currentPolygon.intersects;
                                splitResults[0].polygon.newPolygon = true;
                                polygonStack.push(splitResults[0].polygon);
                                this.replacePolygon(currentPolygon, splitResults[0].polygon);
                                break;
                            }
                            else {
                                if ((splitResults[0].type == "coplanar-front") || (splitResults[0].type == "coplanar-back")) {
                                    currentPolygon.setState(splitResults[0].type);
                                    currentPolygon.coplanar = true;
                                }
                            }
                        }
                    }
                }

                currentPolygon = polygonStack.pop();
            }

            polygonStack = this.polygons.filter(polygon => (polygon.valid == true) && (polygon.intersects == true));
            currentPolygon = polygonStack.pop();
            let inside = false;

            while (currentPolygon) {
                if (!currentPolygon.valid) {
                    continue;
                }

                inside = false;
                if (targetOctree?.box?.containsPoint(currentPolygon.getMidpoint())) {
                    if (OctreeCSG.useWindingNumber === true) {
                        inside = polyInside_WindingNumber_buffer(targetOctreeBuffer as Float32Array, currentPolygon.getMidpoint(), currentPolygon.coplanar);
                    }
                    else {
                        let point = pointRounding(_v2.copy(currentPolygon.getMidpoint()));

                        _ray.origin.copy(point);
                        _rayDirection.copy(currentPolygon.plane.normal);
                        _ray.direction.copy(currentPolygon.plane.normal);

                        let intersects = targetOctree.rayIntersect(_ray);
                        if (intersects.length) {
                            if (_rayDirection.dot(intersects[0].polygon.plane.normal) > 0) {
                                inside = true;
                            }
                        }
                        if (!inside && currentPolygon.coplanar) {
                            for (let j = 0; j < _wP_EPS_ARR_COUNT; j++) {
                                _ray.origin.copy(point).add(_wP_EPS_ARR[j]);
                                _rayDirection.copy(currentPolygon.plane.normal);
                                _ray.direction.copy(currentPolygon.plane.normal);
                                let intersects = targetOctree.rayIntersect(_ray);
                                if (intersects.length) {
                                    if (_rayDirection.dot(intersects[0].polygon.plane.normal) > 0) {
                                        inside = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                if (inside === true) {
                    currentPolygon.setState("inside");
                }
                else {
                    currentPolygon.setState("outside");
                }

                currentPolygon = polygonStack.pop();
            }
        }

        for (let i = 0; i < this.subTrees.length; i++) {
            this.subTrees[i].handleIntersectingPolygons(targetOctree, targetOctreeBuffer);
        }
    }

    delete(deletePolygons = true) {
        if (this.polygons.length > 0 && deletePolygons) {
            this.polygons.forEach(p => p.delete());
            this.polygons.length = 0;
        }
        if (this.replacedPolygons.length > 0 && deletePolygons) {
            this.replacedPolygons.forEach(p => p.delete());
            this.replacedPolygons.length = 0;
        }
        if (this.polygonArrays) {
            this.polygonArrays.length = 0;
        }

        if (this.subTrees.length) {
            for (let i = 0; i < this.subTrees.length; i++) {
                this.subTrees[i].delete(deletePolygons);
            }
            this.subTrees.length = 0;
        }
        this.box = undefined;
        this.parent = null;
        this.level = 0;
    }

    dispose(deletePolygons = true) {
        this.delete(deletePolygons);
    }

    getPolygonCloneCallback(cbFunc: (polygon: Polygon, trianglesSet: Set<string>) => unknown, trianglesSet: Set<string>) {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                for (let i = 0; i < polygonsArray.length; i++) {
                    if (polygonsArray[i].valid) {
                        cbFunc(polygonsArray[i].clone(), trianglesSet);
                    }
                }
            }
        });
    }

    deleteReplacedPolygons() {
        if (this.replacedPolygons.length > 0) {
            this.replacedPolygons.forEach(p => p.delete());
            this.replacedPolygons.length = 0;
        }
        for (let i = 0; i < this.subTrees.length; i++) {
            this.subTrees[i].deleteReplacedPolygons();
        }
    }

    markPolygonsAsOriginal() {
        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                polygonsArray.forEach(p => p.originalValid = true);
            }
        });
    }

    applyMatrix(matrix: Matrix4, normalMatrix: Matrix3, firstRun = true) {
        this.box?.makeEmpty();
        normalMatrix = normalMatrix || tmpm3.getNormalMatrix(matrix);

        if (this.polygons.length > 0) {
            for (let i = 0; i < this.polygons.length; i++) {
                if (this.polygons[i].valid) {
                    this.polygons[i].applyMatrix(matrix, normalMatrix);
                }
            }
        }

        for (let i = 0; i < this.subTrees.length; i++) {
            this.subTrees[i].applyMatrix(matrix, normalMatrix, false);
        }

        if (firstRun) {
            this.processTree();
        }
    }

    setPolygonIndex(index: number) {
        if (index === undefined) {
            return;
        }

        this.polygonArrays.forEach(polygonsArray => {
            if (polygonsArray.length) {
                polygonsArray.forEach(p => p.shared = index);
            }
        });
    }

    // utils from OctreeCSG.extended.js
    getTriangles(triangles: Triangle[] = []) {
        let polygons = this.getPolygons();
        polygons.forEach(p => triangles.push(p.triangle));
        return triangles;
    }

    getRayTriangles(ray: Ray, triangles: Triangle[] = []) {
        let polygons = this.getRayPolygons(ray);
        polygons.forEach(p => triangles.push(p.triangle));
        return triangles;
    }

    /*
    Union:
    1. Delete all polygons in A that are:
        a. inside and coplanar-back
        b. inside
    2. Delete all polygons in B that are:
        a. inside and coplanar-back
        b. inside and coplanar-front
        c. inside
    */
    static union(octreeA: OctreeCSG, octreeB: OctreeCSG, buildTargetOctree = true) {
        let octree = new OctreeCSG();
        let trianglesSet = new Set<string>();
        if ((octreeA.box as Box3).intersectsBox(octreeB.box as Box3)) {
            octreeA.resetPolygons(false);
            octreeB.resetPolygons(false);

            octreeA.markIntesectingPolygons(octreeB);
            octreeB.markIntesectingPolygons(octreeA);

            handleIntersectingOctrees(octreeA, octreeB);
            octreeA.deleteReplacedPolygons();
            octreeB.deleteReplacedPolygons();



            octreeA.deletePolygonsByStateRules(CSG_Rules.union.a);
            octreeB.deletePolygonsByStateRules(CSG_Rules.union.b);


            octreeA.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
            octreeB.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
        }
        else {
            octreeA.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
            octreeB.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
        }

        trianglesSet.clear();

        octree.markPolygonsAsOriginal();
        buildTargetOctree && octree.buildTree();

        return octree;
    }

    /*
    Subtract:
    1. Delete all polygons in A that are:
        a. inside and coplanar-back
        b. inside and coplanar-front
        c. inside
    2. Delete all polygons in B that are:
        a. outside and coplanar-back
        b. outside and coplanar-front
        c. inside and coplanar-front
        d. outside
    */
    static subtract(octreeA: OctreeCSG, octreeB: OctreeCSG, buildTargetOctree = true) {
        let octree = new OctreeCSG();
        let trianglesSet = new Set<string>();
        if ((octreeA.box as Box3).intersectsBox(octreeB.box as Box3)) {
            octreeA.resetPolygons(false);
            octreeB.resetPolygons(false);
            octreeA.markIntesectingPolygons(octreeB);
            octreeB.markIntesectingPolygons(octreeA);


            handleIntersectingOctrees(octreeA, octreeB);
            octreeA.deleteReplacedPolygons();
            octreeB.deleteReplacedPolygons();

            octreeA.deletePolygonsByStateRules(CSG_Rules.subtract.a);
            octreeB.deletePolygonsByStateRules(CSG_Rules.subtract.b);


            octreeB.deletePolygonsByIntersection(false);

            octreeB.invert();

            octreeA.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
            octreeB.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
        }
        else {
            octreeA.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
        }

        trianglesSet.clear();

        octree.markPolygonsAsOriginal();
        buildTargetOctree && octree.buildTree();

        return octree;
    }

    /*
    Intersect:
    1. Delete all polygons in A that are:
        a. inside and coplanar-back
        b. outside and coplanar-front
        c. outside and coplanar-back
        d. outside
    2. Delete all polygons in B that are:
        a. inside and coplanar-front
        b. inside and coplanar-back
        c. outside and coplanar-front
        d. outside and coplanar-back
        e. outside
    */
    static intersect(octreeA: OctreeCSG, octreeB: OctreeCSG, buildTargetOctree = true) {
        let octree = new OctreeCSG();
        let trianglesSet = new Set<string>();

        if ((octreeA.box as Box3).intersectsBox(octreeB.box as Box3)) {
            octreeA.resetPolygons(false);
            octreeB.resetPolygons(false);

            octreeA.markIntesectingPolygons(octreeB);
            octreeB.markIntesectingPolygons(octreeA);

            handleIntersectingOctrees(octreeA, octreeB);
            octreeA.deleteReplacedPolygons();
            octreeB.deleteReplacedPolygons();

            octreeA.deletePolygonsByStateRules(CSG_Rules.intersect.a);
            octreeB.deletePolygonsByStateRules(CSG_Rules.intersect.b);

            octreeA.deletePolygonsByIntersection(false);
            octreeB.deletePolygonsByIntersection(false);

            octreeA.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
            octreeB.getPolygonCloneCallback(octree.addPolygon.bind(octree), trianglesSet);
        }

        trianglesSet.clear();

        octree.markPolygonsAsOriginal();
        buildTargetOctree && octree.buildTree();

        return octree;
    }

    static unionArray(objArr: OctreeCSG[], materialIndexMax = Infinity) {
        let octreesArray = [];
        for (let i = 0; i < objArr.length; i++) {
            let materialIndex = i > materialIndexMax ? materialIndexMax : i;
            const tempOctree = objArr[i];
            tempOctree.setPolygonIndex(materialIndex);
            octreesArray.push(tempOctree);
        }
        let octreeA = octreesArray.shift();
        let octreeB = octreesArray.shift();
        while (octreeA && octreeB) {
            let resultOctree = OctreeCSG.union(octreeA, octreeB);
            disposeOctree(octreeA, octreeB);
            octreeA = resultOctree;
            octreeB = octreesArray.shift();
        }
        return octreeA;
    }

    static subtractArray(objArr: OctreeCSG[], materialIndexMax = Infinity) {
        let octreesArray = [];
        for (let i = 0; i < objArr.length; i++) {
            let materialIndex = i > materialIndexMax ? materialIndexMax : i;
            const tempOctree = objArr[i];
            tempOctree.setPolygonIndex(materialIndex);
            octreesArray.push(tempOctree);
        }
        let octreeA = octreesArray.shift();
        let octreeB = octreesArray.shift();
        while (octreeA && octreeB) {
            let resultOctree = OctreeCSG.subtract(octreeA, octreeB);
            disposeOctree(octreeA, octreeB);
            octreeA = resultOctree;
            octreeB = octreesArray.shift();
        }
        return octreeA;
    }

    static intersectArray(objArr: OctreeCSG[], materialIndexMax = Infinity) {
        let octreesArray = [];
        for (let i = 0; i < objArr.length; i++) {
            let materialIndex = i > materialIndexMax ? materialIndexMax : i;
            const tempOctree = objArr[i];
            tempOctree.setPolygonIndex(materialIndex);
            octreesArray.push(tempOctree);
        }
        let octreeA = octreesArray.shift();
        let octreeB = octreesArray.shift();
        while (octreeA && octreeB) {
            let resultOctree = OctreeCSG.intersect(octreeA, octreeB);
            disposeOctree(octreeA, octreeB);
            octreeA = resultOctree;
            octreeB = octreesArray.shift();
        }
        return octreeA;
    }

    static operation(obj: OctreeCSGObject, buildTargetOctree = true, options = { objCounter: 0 }) {
        let resultOctree: OctreeCSG;
        const octreeA = handleObjectForOp(obj.objA, buildTargetOctree, options);
        const octreeB = handleObjectForOp(obj.objB, buildTargetOctree, options);

        switch (obj.op) {
            case 'union':
                resultOctree = OctreeCSG.union(octreeA, octreeB, buildTargetOctree);
                break;
            case 'subtract':
                resultOctree = OctreeCSG.subtract(octreeA, octreeB, buildTargetOctree);
                break;
            case 'intersect':
                resultOctree = OctreeCSG.intersect(octreeA, octreeB, buildTargetOctree);
                break;
            default:
                throw new Error(`Unknown operation: ${obj.op}`);
        }

        disposeOctree(octreeA, octreeB);

        return resultOctree;
    }

    static rayIntersectsTriangle(ray: Ray, triangle: Triangle, target = new Vector3()) {
        // https://en.wikipedia.org/wiki/M%C3%B6ller%E2%80%93Trumbore_intersection_algorithm
        edge1.subVectors(triangle.b, triangle.a);
        edge2.subVectors(triangle.c, triangle.a);
        h.crossVectors(ray.direction, edge2);
        let a = edge1.dot(h);
        if (a > -RAY_EPSILON && a < RAY_EPSILON) {
            return null; // Ray is parallel to the triangle
        }
        let f = 1 / a;
        s.subVectors(ray.origin, triangle.a);
        let u = f * s.dot(h);
        if (u < 0 || u > 1) {
            return null;
        }
        q.crossVectors(s, edge1);
        let v = f * ray.direction.dot(q);
        if (v < 0 || u + v > 1) {
            return null;
        }
        // Check where intersection is
        let t = f * edge2.dot(q);
        if (t > RAY_EPSILON) {
            return target.copy(ray.direction).multiplyScalar(t).add(ray.origin);
        }
        // else {
        return null;
        // }
    }

    // TODO use workers
    static async = {
        batchSize: 100,

        union(octreeA: OctreeCSG, octreeB: OctreeCSG, buildTargetOctree = true): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let result = OctreeCSG.union(octreeA, octreeB, buildTargetOctree);
                    resolve(result);
                    disposeOctree(octreeA, octreeB);
                }
                catch (e) {
                    reject(e);
                }
            });
        },

        subtract(octreeA: OctreeCSG, octreeB: OctreeCSG, buildTargetOctree = true): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let result = OctreeCSG.subtract(octreeA, octreeB, buildTargetOctree);
                    resolve(result);
                    disposeOctree(octreeA, octreeB);
                }
                catch (e) {
                    reject(e);
                }
            });
        },

        intersect(octreeA: OctreeCSG, octreeB: OctreeCSG, buildTargetOctree = true): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let result = OctreeCSG.intersect(octreeA, octreeB, buildTargetOctree);
                    resolve(result);
                    disposeOctree(octreeA, octreeB);
                }
                catch (e) {
                    reject(e);
                }
            });
        },

        unionArray(objArr: OctreeCSG[], materialIndexMax = Infinity): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let usingBatches = OctreeCSG.async.batchSize > 4 && OctreeCSG.async.batchSize < objArr.length;
                    let mainOctree: OctreeCSG;
                    let mainOctreeUsed = false;
                    let promises = [];

                    if (usingBatches) {
                        let batches = [];
                        let currentIndex = 0;

                        while (currentIndex < objArr.length) {
                            batches.push(objArr.slice(currentIndex, currentIndex + OctreeCSG.async.batchSize));
                            currentIndex += OctreeCSG.async.batchSize
                        }

                        let batch = batches.shift();

                        while (batch) {
                            let promise = OctreeCSG.async.unionArray(batch, 0);
                            promises.push(promise);
                            batch = batches.shift();
                        }

                        usingBatches = true;
                        mainOctreeUsed = true;
                        objArr.length = 0;
                    }
                    else {
                        let octreesArray: OctreeCSG[] = [];
                        for (let i = 0; i < objArr.length; i++) {
                            let materialIndex = i > materialIndexMax ? materialIndexMax : i;

                            const tempOctree = objArr[i];

                            if (materialIndexMax > -1) {
                                tempOctree.setPolygonIndex(materialIndex);
                            }

                            octreesArray.push(tempOctree);
                        }

                        mainOctree = octreesArray.shift() as OctreeCSG;

                        let leftOverOctree;
                        for (let i = 0; i < octreesArray.length; i += 2) {
                            if (i + 1 >= octreesArray.length) {
                                leftOverOctree = octreesArray[i];
                                break;
                            }

                            let promise = OctreeCSG.async.union(octreesArray[i], octreesArray[i + 1]);
                            promises.push(promise);
                        }

                        if (leftOverOctree) {
                            let promise = OctreeCSG.async.union(mainOctree, leftOverOctree);
                            promises.push(promise);
                            mainOctreeUsed = true;
                        }
                    }

                    Promise.allSettled(promises).then(results => {
                        let octrees: OctreeCSG[] = []
                        results.forEach(r => {
                            if (r.status === "fulfilled") {
                                octrees.push(r.value);
                            }
                        });

                        if (!mainOctreeUsed) {
                            octrees.unshift(mainOctree);
                        }

                        if (octrees.length > 0) {
                            if (octrees.length === 1) {
                                resolve(octrees[0]);
                            }
                            else if (octrees.length > 3) {
                                OctreeCSG.async.unionArray(octrees, usingBatches ? 0 : -1).then(result => {
                                    resolve(result);
                                }).catch(e => reject(e));
                            }
                            else {
                                OctreeCSG.async.union(octrees[0], octrees[1]).then(result => {
                                    if (octrees.length === 3) {
                                        OctreeCSG.async.union(result, octrees[2]).then(result => {
                                            resolve(result);
                                        }).catch(e => reject(e));
                                    }
                                    else {
                                        resolve(result);
                                    }
                                }).catch(e => reject(e));
                            }
                        }
                        else {
                            reject('Unable to find any result octree');
                        }
                    });
                }
                catch (e) {
                    reject(e);
                }
            });
        },

        subtractArray(objArr: OctreeCSG[], materialIndexMax = Infinity): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let usingBatches = OctreeCSG.async.batchSize > 4 && OctreeCSG.async.batchSize < objArr.length;
                    let mainOctree: OctreeCSG;
                    let mainOctreeUsed = false;
                    let promises = [];
                    if (usingBatches) {
                        let batches = [];
                        let currentIndex = 0;
                        while (currentIndex < objArr.length) {
                            batches.push(objArr.slice(currentIndex, currentIndex + OctreeCSG.async.batchSize));
                            currentIndex += OctreeCSG.async.batchSize
                        }

                        let batch = batches.shift();
                        while (batch) {
                            let promise = OctreeCSG.async.subtractArray(batch, 0);
                            promises.push(promise);
                            batch = batches.shift();
                        }
                        usingBatches = true;
                        mainOctreeUsed = true;
                        objArr.length = 0;
                    }
                    else {
                        let octreesArray = [];
                        for (let i = 0; i < objArr.length; i++) {
                            let materialIndex = i > materialIndexMax ? materialIndexMax : i;
                            const tempOctree = objArr[i];
                            if (materialIndexMax > -1) {
                                tempOctree.setPolygonIndex(materialIndex);
                            }

                            octreesArray.push(tempOctree);
                        }

                        mainOctree = octreesArray.shift() as OctreeCSG;

                        let leftOverOctree;
                        for (let i = 0; i < octreesArray.length; i += 2) {
                            if (i + 1 >= octreesArray.length) {
                                leftOverOctree = octreesArray[i];
                                break;
                            }

                            let promise = OctreeCSG.async.subtract(octreesArray[i], octreesArray[i + 1]);
                            promises.push(promise);
                        }

                        if (leftOverOctree) {
                            let promise = OctreeCSG.async.subtract(mainOctree, leftOverOctree);
                            promises.push(promise);
                            mainOctreeUsed = true;
                        }
                    }

                    Promise.allSettled(promises).then(results => {
                        let octrees: OctreeCSG[] = []
                        results.forEach(r => {
                            if (r.status === "fulfilled") {
                                octrees.push(r.value);
                            }
                        });
                        if (!mainOctreeUsed) {
                            octrees.unshift(mainOctree);
                        }
                        if (octrees.length > 0) {
                            if (octrees.length === 1) {
                                resolve(octrees[0]);
                            }
                            else if (octrees.length > 3) {
                                OctreeCSG.async.subtractArray(octrees, usingBatches ? 0 : -1).then(result => {
                                    resolve(result);
                                }).catch(e => reject(e));
                            }
                            else {
                                OctreeCSG.async.subtract(octrees[0], octrees[1]).then(result => {
                                    if (octrees.length === 3) {
                                        OctreeCSG.async.subtract(result, octrees[2]).then(result => {
                                            resolve(result);
                                        }).catch(e => reject(e));
                                    }
                                    else {
                                        resolve(result);
                                    }
                                }).catch(e => reject(e));
                            }
                        }
                        else {
                            reject('Unable to find any result octree');
                        }
                    });
                }
                catch (e) {
                    reject(e);
                }
            });
        },

        intersectArray(objArr: OctreeCSG[], materialIndexMax = Infinity): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let usingBatches = OctreeCSG.async.batchSize > 4 && OctreeCSG.async.batchSize < objArr.length;
                    let mainOctree: OctreeCSG;
                    let mainOctreeUsed = false;
                    let promises = [];
                    if (usingBatches) {
                        let batches = [];
                        let currentIndex = 0;
                        while (currentIndex < objArr.length) {
                            batches.push(objArr.slice(currentIndex, currentIndex + OctreeCSG.async.batchSize));
                            currentIndex += OctreeCSG.async.batchSize
                        }

                        let batch = batches.shift();
                        while (batch) {
                            let promise = OctreeCSG.async.intersectArray(batch, 0);
                            promises.push(promise);
                            batch = batches.shift();
                        }
                        usingBatches = true;
                        mainOctreeUsed = true;
                        objArr.length = 0;
                    }
                    else {
                        let octreesArray = [];
                        for (let i = 0; i < objArr.length; i++) {
                            let materialIndex = i > materialIndexMax ? materialIndexMax : i;
                            const tempOctree = objArr[i];
                            if (materialIndexMax > -1) {
                                tempOctree.setPolygonIndex(materialIndex);
                            }
                            octreesArray.push(tempOctree);
                        }
                        mainOctree = octreesArray.shift() as OctreeCSG;

                        let leftOverOctree;
                        for (let i = 0; i < octreesArray.length; i += 2) {
                            if (i + 1 >= octreesArray.length) {
                                leftOverOctree = octreesArray[i];
                                break;
                            }

                            let promise = OctreeCSG.async.intersect(octreesArray[i], octreesArray[i + 1]);
                            promises.push(promise);
                        }

                        if (leftOverOctree) {
                            let promise = OctreeCSG.async.intersect(mainOctree, leftOverOctree);
                            promises.push(promise);
                            mainOctreeUsed = true;
                        }
                    }

                    Promise.allSettled(promises).then(results => {
                        let octrees: OctreeCSG[] = []
                        results.forEach(r => {
                            if (r.status === "fulfilled") {
                                octrees.push(r.value);
                            }
                        });
                        if (!mainOctreeUsed) {
                            octrees.unshift(mainOctree);
                        }
                        if (octrees.length > 0) {
                            if (octrees.length === 1) {
                                resolve(octrees[0]);
                            }
                            else if (octrees.length > 3) {
                                OctreeCSG.async.intersectArray(octrees, usingBatches ? 0 : -1).then(result => {
                                    resolve(result);
                                }).catch(e => reject(e));
                            }
                            else {
                                OctreeCSG.async.intersect(octrees[0], octrees[1]).then(result => {
                                    if (octrees.length === 3) {
                                        OctreeCSG.async.intersect(result, octrees[2]).then(result => {
                                            resolve(result);
                                        }).catch(e => reject(e));
                                    }
                                    else {
                                        resolve(result);
                                    }
                                }).catch(e => reject(e));
                            }
                        }
                        else {
                            reject('Unable to find any result octree');
                        }
                    });
                }
                catch (e) {
                    reject(e);
                }
            });
        },

        operation(obj: OctreeCSGObject, buildTargetOctree = true, options = { objCounter: 0 }): Promise<OctreeCSG> {
            return new Promise((resolve, reject) => {
                try {
                    let octreeA: OctreeCSG, octreeB: OctreeCSG;

                    let promises = []
                    if (obj.objA) {
                        let promise = handleObjectForOp_async(obj.objA, buildTargetOctree, options, 0);
                        promises.push(promise);
                    }

                    if (obj.objB) {
                        let promise = handleObjectForOp_async(obj.objB, buildTargetOctree, options, 1);
                        promises.push(promise);
                    }

                    Promise.allSettled(promises).then(results => {
                        results.forEach(r => {
                            if (r.status === "fulfilled") {
                                const [csg, objIndex] = r.value;
                                if (objIndex === 0) {
                                    octreeA = csg;
                                }
                                else if (objIndex === 1) {
                                    octreeB = csg;
                                }
                            }
                        });

                        let resultPromise;
                        switch (obj.op) {
                            case 'union':
                                resultPromise = OctreeCSG.async.union(octreeA, octreeB, buildTargetOctree);
                                break;
                            case 'subtract':
                                resultPromise = OctreeCSG.async.subtract(octreeA, octreeB, buildTargetOctree);
                                break;
                            case 'intersect':
                                resultPromise = OctreeCSG.async.intersect(octreeA, octreeB, buildTargetOctree);
                                break;
                            default:
                                throw new Error(`Unknown operation: ${obj.op}`);
                        }

                        resultPromise.then(resultOctree => {
                            resolve(resultOctree);
                            disposeOctree(octreeA, octreeB);
                        }).catch(e => reject(e));
                    });
                }
                catch (e) {
                    reject(e);
                }
            });
        }
    }
}

function raycastIntersectAscSort(a: RayIntersect, b: RayIntersect) {
    return a.distance - b.distance;
}

function pointRounding(point: Vector3, num = 15) {
    point.x = +point.x.toFixed(num);
    point.y = +point.y.toFixed(num);
    point.z = +point.z.toFixed(num);
    return point;
}

interface ReturnPolygon {
    polygon: Polygon,
    type: string
};

function splitPolygonByPlane(polygon: Polygon, plane: Plane, result: ReturnPolygon[] = []) {
    let returnPolygon = {
        polygon: polygon,
        type: "undecided"
    };

    let polygonType = 0;
    let types = [];

    for (let i = 0; i < polygon.vertices.length; i++) {
        let t = plane.normal.dot(polygon.vertices[i].pos) - plane.w;
        let type = (t < -EPSILON) ? BACK : (t > EPSILON) ? FRONT : COPLANAR;
        polygonType |= type;
        types.push(type);
    }

    switch (polygonType) {
        case COPLANAR:
            returnPolygon.type = plane.normal.dot(polygon.plane.normal) > 0 ? "coplanar-front" : "coplanar-back";
            result.push(returnPolygon);
            break;
        case FRONT:
            returnPolygon.type = "front";
            result.push(returnPolygon);
            break;
        case BACK:
            returnPolygon.type = "back";
            result.push(returnPolygon);
            break;
        case SPANNING:
            let f = [];
            let b = [];
            for (let i = 0; i < polygon.vertices.length; i++) {
                let j = (i + 1) % polygon.vertices.length;
                let ti = types[i];
                let tj = types[j];
                let vi = polygon.vertices[i];
                let vj = polygon.vertices[j];
                if (ti != BACK) {
                    f.push(vi);
                }
                if (ti != FRONT) {
                    b.push(ti != BACK ? vi.clone() : vi);
                }
                if ((ti | tj) == SPANNING) {
                    let t = (plane.w - plane.normal.dot(vi.pos)) / plane.normal.dot(tv0.copy(vj.pos).sub(vi.pos));
                    let v = vi.interpolate(vj, t);
                    f.push(v);
                    b.push(v.clone());
                }
            }
            if (f.length >= 3) {
                if (f.length > 3) {
                    let newPolys = splitPolygonArr(f);
                    for (let npI = 0; npI < newPolys.length; npI++) {
                        result.push({
                            polygon: new Polygon(newPolys[npI], polygon.shared),
                            type: "front"
                        });
                    }
                }
                else {
                    result.push({
                        polygon: new Polygon(f, polygon.shared),
                        type: "front"
                    });
                }
            }
            if (b.length >= 3) {
                if (b.length > 3) {
                    let newPolys = splitPolygonArr(b);
                    for (let npI = 0; npI < newPolys.length; npI++) {
                        result.push({
                            polygon: new Polygon(newPolys[npI], polygon.shared),
                            type: "back"
                        });
                    }
                }
                else {
                    result.push({
                        polygon: new Polygon(b, polygon.shared),
                        type: "back"
                    });
                }
            }
            break;
    }

    if (result.length == 0) {
        result.push(returnPolygon);
    }

    return result;
}

function splitPolygonArr(arr: Vertex[]) {
    let resultArr = [];

    if (arr.length > 4) {
        console.warn("[splitPolygonArr] arr.length > 4", arr.length);
        for (let j = 3; j <= arr.length; j++) {
            let result = [];
            result.push(arr[0].clone());
            result.push(arr[j - 2].clone());
            result.push(arr[j - 1].clone());
            resultArr.push(result);
        }
    }
    else {
        if (arr[0].pos.distanceTo(arr[2].pos) <= arr[1].pos.distanceTo(arr[3].pos)) {
            resultArr.push([arr[0].clone(), arr[1].clone(), arr[2].clone()],
                [arr[0].clone(), arr[2].clone(), arr[3].clone()]);
        }
        else {
            resultArr.push([arr[0].clone(), arr[1].clone(), arr[3].clone()],
                [arr[1].clone(), arr[2].clone(), arr[3].clone()]);
        }
        return resultArr;

    }

    return resultArr;
}

type CSGRule = {
    array: boolean,
    rule: PolygonState | PolygonState[]
};

type CSGRulesArray = CSGRule[];

const CSG_Rules = {
    union: {
        a: <CSGRulesArray>[
            {
                array: true,
                rule: ["inside", "coplanar-back"]
            },
            {
                array: false,
                rule: "inside"
            }
        ],
        b: <CSGRulesArray>[
            {
                array: true,
                rule: ["inside", "coplanar-back"]
            },
            {
                array: true,
                rule: ["inside", "coplanar-front"]
            },
            {
                array: false,
                rule: "inside"
            }
        ]
    },
    subtract: {
        a: <CSGRulesArray>[
            {
                array: true,
                rule: ["inside", "coplanar-back"]
            },
            {
                array: true,
                rule: ["inside", "coplanar-front"]
            },
            {
                array: false,
                rule: "inside"
            }
        ],
        b: <CSGRulesArray>[
            {
                array: true,
                rule: ["outside", "coplanar-back"]
            },
            {
                array: true,
                rule: ["outside", "coplanar-front"]
            },
            {
                array: true,
                rule: ["inside", "coplanar-front"]
            },
            {
                array: false,
                rule: "outside"
            }
        ]
    },
    intersect: {
        a: <CSGRulesArray>[
            {
                array: true,
                rule: ["inside", "coplanar-back"]
            },
            {
                array: true,
                rule: ["outside", "coplanar-front"]
            },
            {
                array: true,
                rule: ["outside", "coplanar-back"]
            },
            {
                array: false,
                rule: "outside"
            }
        ],
        b: <CSGRulesArray>[
            {
                array: true,
                rule: ["inside", "coplanar-front"]
            },
            {
                array: true,
                rule: ["inside", "coplanar-back"]
            },
            {
                array: true,
                rule: ["outside", "coplanar-front"]
            },
            {
                array: true,
                rule: ["outside", "coplanar-back"]
            },
            {
                array: false,
                rule: "outside"
            }
        ]
    }
};

function handleObjectForOp(obj: OctreeCSG | OctreeCSGObject, buildTargetOctree: boolean, options: {objCounter: number}) {
    if (obj instanceof OctreeCSG)
        return obj;
    else if (obj.op)
        return OctreeCSG.operation(obj, buildTargetOctree, options);
    else
        throw new Error('Invalid OctreeCSG operation object');
}

function handleObjectForOp_async(obj: OctreeCSG | OctreeCSGObject, buildTargetOctree: boolean, options: { objCounter: number }, objIndex: number): Promise<[csg: OctreeCSG, objIndex: number]> {
    return new Promise((resolve, reject) => {
        try {
            let returnObj;
            if (obj instanceof OctreeCSG) {
                returnObj = obj;
                resolve([returnObj, objIndex]);
            }
            else if (obj.op) {
                OctreeCSG.async.operation(obj, buildTargetOctree, options).then(returnObj => {
                    resolve([returnObj, objIndex]);
                });
            }
            else
                throw new Error('Invalid OctreeCSG operation object');
        }
        catch (e) {
            reject(e);
        }
    });
}

function isUniqueTriangle(triangle: Triangle, set: Set<string>) {
    const hash1 = `{${triangle.a.x},${triangle.a.y},${triangle.a.z}}-{${triangle.b.x},${triangle.b.y},${triangle.b.z}}-{${triangle.c.x},${triangle.c.y},${triangle.c.z}}`;

    if (set.has(hash1)) {
        return false;
    }
    else {
        set.add(hash1);
        return true;
    }
}

function disposeOctree(...octrees: OctreeCSG[]) {
    if (OctreeCSG.disposeOctree) {
        octrees.forEach(octree => octree.delete());
    }
}

function handleIntersectingOctrees(octreeA: OctreeCSG, octreeB: OctreeCSG, bothOctrees = true) {
    let octreeA_buffer;
    let octreeB_buffer;
    if (OctreeCSG.useWindingNumber === true) {
        if (bothOctrees) {
            octreeA_buffer = prepareTriangleBuffer(octreeA.getPolygons());
        }

        octreeB_buffer = prepareTriangleBuffer(octreeB.getPolygons());
    }

    octreeA.handleIntersectingPolygons(octreeB, octreeB_buffer);

    if (bothOctrees) {
        octreeB.handleIntersectingPolygons(octreeA, octreeA_buffer);
    }

    if (octreeA_buffer !== undefined) {
        octreeA_buffer = undefined;
        octreeB_buffer = undefined;
    }
}

function prepareTriangleBuffer(polygons: Polygon[]) {
    let numOfTriangles = polygons.length;
    let array = new Float32Array(numOfTriangles * 3 * 3);
    let bufferIndex = 0;
    for (let i = 0; i < numOfTriangles; i++) {
        let triangle = polygons[i].triangle;
        array[bufferIndex++] = triangle.a.x;
        array[bufferIndex++] = triangle.a.y;
        array[bufferIndex++] = triangle.a.z;
        array[bufferIndex++] = triangle.b.x;
        array[bufferIndex++] = triangle.b.y;
        array[bufferIndex++] = triangle.b.z;
        array[bufferIndex++] = triangle.c.x;
        array[bufferIndex++] = triangle.c.y;
        array[bufferIndex++] = triangle.c.z;
    }

    return array;
}

export default OctreeCSG;
export { OctreeCSG as CSG, OctreeCSG, Polygon, Plane, Vertex };