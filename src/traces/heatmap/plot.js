/**
* Copyright 2012-2015, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var d3 = require('d3');
var tinycolor = require('tinycolor2');

var Plotly = require('../../plotly');
var Lib = require('../../lib');

var maxRowLength = require('./max_row_length');


// From http://www.xarg.org/2010/03/generate-client-side-png-files-using-javascript/
module.exports = function(gd, plotinfo, cdheatmaps) {
    cdheatmaps.forEach(function(cd) { plotOne(gd, plotinfo, cd); });
};

function plotOne(gd, plotinfo, cd) {
    Lib.markTime('in Heatmap.plot');

    var trace = cd[0].trace,
        uid = trace.uid,
        xa = plotinfo.x(),
        ya = plotinfo.y(),
        fullLayout = gd._fullLayout,
        id = 'hm' + uid,
        cbId = 'cb' + uid;

    fullLayout._paper.selectAll('.contour' + uid).remove(); // in case this used to be a contour map

    if(trace.visible !== true) {
        fullLayout._paper.selectAll('.' + id).remove();
        fullLayout._paper.selectAll('.' + cbId).remove();
        return;
    }

    var z = cd[0].z,
        min = trace.zmin,
        max = trace.zmax,
        scl = Plotly.Colorscale.getScale(trace.colorscale),
        x = cd[0].x,
        y = cd[0].y,
        isContour = Plotly.Plots.traceIs(trace, 'contour'),
        zsmooth = isContour ? 'best' : trace.zsmooth,

        // get z dims
        m = z.length,
        n = maxRowLength(z),
        xrev = false,
        left,
        right,
        temp,
        yrev = false,
        top,
        bottom,
        i;

    // TODO: if there are multiple overlapping categorical heatmaps,
    // or if we allow category sorting, then the categories may not be
    // sequential... may need to reorder and/or expand z

    // Get edges of png in pixels (xa.c2p() maps axes coordinates to pixel coordinates)
    // figure out if either axis is reversed (y is usually reversed, in pixel coords)
    // also clip the image to maximum 50% outside the visible plot area
    // bigger image lets you pan more naturally, but slows performance.
    // TODO: use low-resolution images outside the visible plot for panning
    // these while loops find the first and last brick bounds that are defined
    // (in case of log of a negative)
    i = 0;
    while(left === undefined && i < x.length - 1) {
        left = xa.c2p(x[i]);
        i++;
    }
    i = x.length - 1;
    while(right === undefined && i > 0) {
        right = xa.c2p(x[i]);
        i--;
    }

    if(right < left) {
        temp = right;
        right = left;
        left = temp;
        xrev = true;
    }

    i = 0;
    while(top === undefined && i < y.length - 1) {
        top = ya.c2p(y[i]);
        i++;
    }
    i = y.length - 1;
    while(bottom === undefined && i > 0) {
        bottom = ya.c2p(y[i]);
        i--;
    }

    if(bottom < top) {
        temp = top;
        top = bottom;
        bottom = temp;
        yrev = true;
    }

    // for contours with heatmap fill, we generate the boundaries based on
    // brick centers but then use the brick edges for drawing the bricks
    if(isContour) {
        // TODO: for 'best' smoothing, we really should use the given brick
        // centers as well as brick bounds in calculating values, in case of
        // nonuniform brick sizes
        x = cd[0].xfill;
        y = cd[0].yfill;
    }

    // make an image that goes at most half a screen off either side, to keep
    // time reasonable when you zoom in. if zsmooth is true/fast, don't worry
    // about this, because zooming doesn't increase number of pixels
    // if zsmooth is best, don't include anything off screen because it takes too long
    if(zsmooth !== 'fast') {
        var extra = zsmooth === 'best' ? 0 : 0.5;
        left = Math.max(-extra * xa._length, left);
        right = Math.min((1 + extra) * xa._length, right);
        top = Math.max(-extra * ya._length, top);
        bottom = Math.min((1 + extra) * ya._length, bottom);
    }

    var imageWidth = Math.round(right - left),
        imageHeight = Math.round(bottom - top);

    // now redraw

    // if image is entirely off-screen, don't even draw it
    if(imageWidth <= 0 || imageHeight <= 0) return;

    var canvasW, canvasH;
    if(zsmooth === 'fast') {
        canvasW = n;
        canvasH = m;
    } else {
        canvasW = imageWidth;
        canvasH = imageHeight;
    }

    var canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    var context = canvas.getContext('2d');

    // interpolate for color scale
    // use an array instead of color strings, so we preserve alpha
    var s = d3.scale.linear()
        .domain(scl.map(function(si){ return si[0]; }))
        .range(scl.map(function(si){
            var c = tinycolor(si[1]).toRgb();
            return [c.r, c.g, c.b, c.a];
        }))
        .clamp(true);

    // map brick boundaries to image pixels
    var xpx,
        ypx;
    if(zsmooth === 'fast') {
        xpx = xrev ?
            function(index) { return n - 1 - index; } :
            Lib.identity;
        ypx = yrev ?
            function(index) { return m - 1 - index; } :
            Lib.identity;
    }
    else {
        xpx = function(index){
            return Lib.constrain(Math.round(xa.c2p(x[index]) - left),
                0, imageWidth);
        };
        ypx = function(index){
            return Lib.constrain(Math.round(ya.c2p(y[index]) - top),
                0, imageHeight);
        };
    }

    // get interpolated bin value. Returns {bin0:closest bin, frac:fractional dist to next, bin1:next bin}
    function findInterp(pixel, pixArray) {
        var maxbin = pixArray.length - 2,
            bin = Lib.constrain(Lib.findBin(pixel, pixArray), 0, maxbin),
            pix0 = pixArray[bin],
            pix1 = pixArray[bin + 1],
            interp = Lib.constrain(bin + (pixel - pix0) / (pix1 - pix0) - 0.5, 0, maxbin),
            bin0 = Math.round(interp),
            frac = Math.abs(interp - bin0);

        if(!interp || interp === maxbin || !frac) {
            return {
                bin0: bin0,
                bin1: bin0,
                frac: 0
            };
        }
        return {
            bin0: bin0,
            frac: frac,
            bin1: Math.round(bin0 + frac / (interp - bin0))
        };
    }

    function setColor(v, pixsize) {
        if(v !== undefined) {
            var c = s((v - min) / (max - min));
            c[0] = Math.round(c[0]);
            c[1] = Math.round(c[1]);
            c[2] = Math.round(c[2]);

            pixcount += pixsize;
            rcount += c[0] * pixsize;
            gcount += c[1] * pixsize;
            bcount += c[2] * pixsize;
            return c;
        }
        return [0, 0, 0, 0];
    }

    function putColor(pixels, pxIndex, c) {
        pixels[pxIndex] = c[0];
        pixels[pxIndex + 1] = c[1];
        pixels[pxIndex + 2] = c[2];
        pixels[pxIndex + 3] = Math.round(c[3] * 255);
    }

    function interpColor(r0, r1, xinterp, yinterp) {
        var z00 = r0[xinterp.bin0];
        if(z00 === undefined) return setColor(undefined, 1);

        var z01 = r0[xinterp.bin1],
            z10 = r1[xinterp.bin0],
            z11 = r1[xinterp.bin1],
            dx = (z01 - z00) || 0,
            dy = (z10 - z00) || 0,
            dxy;

        // the bilinear interpolation term needs different calculations
        // for all the different permutations of missing data
        // among the neighbors of the main point, to ensure
        // continuity across brick boundaries.
        if(z01 === undefined) {
            if(z11 === undefined) dxy = 0;
            else if(z10 === undefined) dxy = 2 * (z11 - z00);
            else dxy = (2 * z11 - z10 - z00) * 2/3;
        }
        else if(z11 === undefined) {
            if(z10 === undefined) dxy = 0;
            else dxy = (2 * z00 - z01 - z10) * 2/3;
        }
        else if(z10 === undefined) dxy = (2 * z11 - z01 - z00) * 2/3;
        else dxy = (z11 + z00 - z01 - z10);

        return setColor(z00 + xinterp.frac * dx + yinterp.frac * (dy + xinterp.frac * dxy));
    }

    Lib.markTime('done init png');

    // build the pixel map brick-by-brick
    // cruise through z-matrix row-by-row
    // build a brick at each z-matrix value
    var yi = ypx(0),
        yb = [yi, yi],
        xbi = xrev ? 0 : 1,
        ybi = yrev ? 0 : 1,
        // for collecting an average luminosity of the heatmap
        pixcount = 0,
        rcount = 0,
        gcount = 0,
        bcount = 0,
        xb,
        j,
        xi,
        v,
        row,
        c;

    if(zsmooth) { // best or fast, works fastest with imageData
        var pxIndex = 0,
            pixels = new Uint8Array(imageWidth * imageHeight * 4);

        if(zsmooth === 'best') {
            var xPixArray = new Array(x.length),
                yPixArray = new Array(y.length),
                xinterpArray = new Array(imageWidth),
                yinterp,
                r0,
                r1;

            // first make arrays of x and y pixel locations of brick boundaries
            for(i = 0; i < x.length; i++) xPixArray[i] = Math.round(xa.c2p(x[i]) - left);
            for(i = 0; i < y.length; i++) yPixArray[i] = Math.round(ya.c2p(y[i]) - top);

            // then make arrays of interpolations
            // (bin0=closest, bin1=next, frac=fractional dist.)
            for(i = 0; i < imageWidth; i++) xinterpArray[i] = findInterp(i, xPixArray);

            // now do the interpolations and fill the png
            for(j = 0; j < imageHeight; j++) {
                yinterp = findInterp(j, yPixArray);
                r0 = z[yinterp.bin0];
                r1 = z[yinterp.bin1];
                for(i = 0; i < imageWidth; i++, pxIndex += 4) {
                    c = interpColor(r0, r1, xinterpArray[i], yinterp);
                    putColor(pixels, pxIndex, c);
                }
            }
        }
        else { // zsmooth = fast
            for(j = 0; j < m; j++) {
                row = z[j];
                yb = ypx(j);
                for(i = 0; i < n; i++) {
                    c = setColor(row[i],1);
                    pxIndex = (yb * imageWidth + xpx(i)) * 4;
                    putColor(pixels, pxIndex, c);
                }
            }
        }

        var imageData = context.createImageData(imageWidth, imageHeight);
        imageData.data.set(pixels);
        context.putImageData(imageData, 0, 0);
    } else { // zsmooth = false -> filling potentially large bricks works fastest with fillRect
        for(j = 0; j < m; j++) {
            row = z[j];
            yb.reverse();
            yb[ybi] = ypx(j + 1);
            if(yb[0] === yb[1] || yb[0] === undefined || yb[1] === undefined) {
                continue;
            }
            xi = xpx(0);
            xb = [xi, xi];
            for(i = 0; i < n; i++) {
                // build one color brick!
                xb.reverse();
                xb[xbi] = xpx(i + 1);
                if(xb[0] === xb[1] || xb[0] === undefined || xb[1] === undefined) {
                    continue;
                }
                v = row[i];
                c = setColor(v, (xb[1] - xb[0]) * (yb[1] - yb[0]));
                context.fillStyle = 'rgba(' + c.join(',') + ')';
                context.fillRect(xb[0], yb[0], (xb[1] - xb[0]), (yb[1] - yb[0]));
            }
        }
    }

    Lib.markTime('done filling png');

    rcount = Math.round(rcount / pixcount);
    gcount = Math.round(gcount/ pixcount);
    bcount = Math.round(bcount / pixcount);
    var avgColor = tinycolor('rgb(' + rcount + ',' + gcount + ',' + bcount + ')');

    gd._hmpixcount = (gd._hmpixcount||0) + pixcount;
    gd._hmlumcount = (gd._hmlumcount||0) + pixcount * avgColor.getLuminance();

    // put this right before making the new image, to minimize flicker
    fullLayout._paper.selectAll('.'+id).remove();
    plotinfo.plot.select('.maplayer').append('svg:image')
        .classed(id, true)
        .datum(cd[0])
        .attr({
            xmlns: 'http://www.w3.org/2000/svg',
            'xlink:xlink:href': canvas.toDataURL('image/png'), // odd d3 quirk, need namespace twice
            height: imageHeight,
            width: imageWidth,
            x: left,
            y: top,
            preserveAspectRatio: 'none'
        });

    Lib.markTime('done showing png');
}
