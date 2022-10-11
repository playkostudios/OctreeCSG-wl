import { vec2 } from 'gl-matrix';
import sort2DIndices from './sort-2d-indices';

export default function triangulateMonotone2DPolygon(polyline: Array<vec2>, output?: Array<vec2>): Array<vec2> {
    const vertexCount = polyline.length;

    // fast paths (and error conditions):
    if (vertexCount < 3) {
        throw new Error(`Expected input polyline with 3 or more vertices, got ${vertexCount}`);
    }

    const outputSize = (vertexCount - 2) * 3;
    if (output) {
        if (output.length < outputSize) {
            output.length = outputSize;
        }
    } else {
        output = new Array(outputSize);
    }

    if (vertexCount === 3) {
        // already a triangle, copy it
        output[0] = vec2.clone(polyline[0]);
        output[1] = vec2.clone(polyline[1]);
        output[2] = vec2.clone(polyline[2]);

        return output;
    } else if (vertexCount === 4) {
        // triangulate a square. special case that avoids sliver triangles
        output[0] = vec2.clone(polyline[0]);
        output[1] = vec2.clone(polyline[1]);
        output[2] = vec2.clone(polyline[2]);

        if (vec2.squaredDistance(polyline[0], polyline[2]) <= vec2.squaredDistance(polyline[1], polyline[3])) {
            output[3] = vec2.clone(polyline[0]);
        } else {
            output[3] = vec2.clone(polyline[1]);
        }

        output[4] = vec2.clone(polyline[2]);
        output[5] = vec2.clone(polyline[3]);

        return output;
    }

    // general case: using monotone polygon triangulation algorithm from a book:
    // Computational Geometry: Algorithms and Applications (second edition,
    // section 3.3), by Mark de Berg, Marc van Krefeld, and Mark Overmars

    // sort vertices by XY respectively
    const indices = sort2DIndices(polyline);
    let stack = [indices[0], indices[1]];
    let iOut = 0;

    for (let i = 2; i < vertexCount - 1; i++) {
        const thisIndex = indices[i];
        const thisVertex = polyline[thisIndex];

        const stackLen = stack.length;
        const topIndex = stack[stackLen - 1];
        const topVertex = polyline[topIndex];

        if ((thisIndex !== (topIndex + 1) % vertexCount) && (topIndex !== (thisIndex + 1) % vertexCount)) {
            for (let j = 0; j < stackLen - 1; j++) {
                const jIndex = stack[j];
                const j1Index = stack[j + 1];
                output[iOut++] = vec2.clone(thisVertex);

                if (j1Index > jIndex) {
                    output[iOut++] = vec2.clone(polyline[jIndex]);
                    output[iOut++] = vec2.clone(polyline[j1Index]);
                } else {
                    output[iOut++] = vec2.clone(polyline[j1Index]);
                    output[iOut++] = vec2.clone(polyline[jIndex]);
                }
            }

            stack = [indices[i - 1], thisIndex];
        } else {
            let lastPoppedVertex = topVertex;
            let lastPoppedIndex = stack.pop();
            while (stack.length > 0) {
                const nextPoppedIndex = stack[stack.length - 1];
                const nextPoppedVertex = polyline[nextPoppedIndex];

                // check if diagonal from current vertex to popped vertex is
                // inside polygon. if not, stop popping
                // 1. get direction from vertex before popped, to popped
                const beforePoppedIndex = (((nextPoppedIndex - 1) % vertexCount) + vertexCount) % vertexCount;
                const beforePoppedVertex = polyline[beforePoppedIndex];
                const dir = vec2.sub(vec2.create(), nextPoppedVertex, beforePoppedVertex);

                // 2. get left of direction (inside direction, since CCW's
                // inside is to the left)
                const insideDir = vec2.fromValues(-dir[1], dir[0]);

                // 3. get direction from verted before popped to current vertex
                const curDir = vec2.sub(vec2.create(), thisVertex, beforePoppedVertex);

                // 4. check if to the left of direction (inside). if not, break
                if (vec2.dot(curDir, insideDir) <= 0) {
                    break;
                }

                lastPoppedIndex = nextPoppedIndex;
                stack.pop();

                output[iOut++] = vec2.clone(thisVertex);

                if (nextPoppedIndex > lastPoppedIndex) {
                    output[iOut++] = vec2.clone(nextPoppedVertex);
                    output[iOut++] = vec2.clone(lastPoppedVertex);
                } else {
                    output[iOut++] = vec2.clone(lastPoppedVertex);
                    output[iOut++] = vec2.clone(nextPoppedVertex);
                }

                lastPoppedVertex = nextPoppedVertex;
            }

            if (lastPoppedIndex !== undefined) {
                stack.push(lastPoppedIndex);
            }

            stack.push(thisIndex);
        }
    }

    const lastVertex = polyline[indices[vertexCount - 1]];
    const iterLen = stack.length - 1;

    for (let i = 0; i < iterLen; i++) {
        output[iOut++] = vec2.clone(lastVertex);
        const iIndex = stack[i];
        const i1Index = stack[i + 1];

        if (i1Index > iIndex) {
            output[iOut++] = vec2.clone(polyline[i1Index]);
            output[iOut++] = vec2.clone(polyline[iIndex]);
        } else {
            output[iOut++] = vec2.clone(polyline[iIndex]);
            output[iOut++] = vec2.clone(polyline[i1Index]);
        }
    }

    return output;
}