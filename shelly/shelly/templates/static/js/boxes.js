(function() {
var boxes = window.Plotly.Boxes = {};

boxes.calc = function(gd,gdc) {
    // box plots make no sense if you don't have y
    if(!('y' in gdc) || gdc.visible===false) { return; }

    // outlier definition based on http://www.physics.csbsju.edu/stats/box2.html
    var xa = gd.layout.xaxis,
        ya = gd.layout.yaxis,
        y = Plotly.Axes.convertOne(gdc,'y',ya), x;
    if('x' in gdc) { x = Plotly.Axes.convertOne(gdc,'x',xa); }
    // if no x data, use x0, or name, or text - so if you want one box
    // per trace, set x0 to the x value or category for this trace
    // (or set x to a constant array matching y)
    else {
        var x0;
        if('x0' in gdc) { x0 = gdc.x0; }
        else if('name' in gdc && xa.type=='category') { x0 = gdc.name; }
        else if('text' in gdc && xa.type=='category') { x0 = gdc.text; }
        else { x0 = gd.numboxes; }
        x0 = Plotly.Axes.convertToNums(x0,xa);
        x = y.map(function(){ return x0; });
    }
    // find x values
    var dv = Plotly.Lib.distinctVals(x),
        xvals = dv.vals,
        dx = dv.minDiff/2,
        cd = xvals.map(function(v){ return {x:v}; }),
        pts = xvals.map(function(){ return []; }),
        bins = xvals.map(function(v){ return v-dx; }),
        l = xvals.length;
    bins.push(xvals[l-1]+dx);
    // y autorange based on all source points - x happens afterward when
    // we know all the x values
    Plotly.Axes.expandBounds(ya,ya._padded,y);
    // bin the points
    y.forEach(function(v,i){
        if(!$.isNumeric(v)){ return; }
        var n = Plotly.Lib.findBin(x[i],bins);
        if(n>=0 && n<l) { pts[n].push(v); }
    });
    // sort the bins and calculate the stats
    pts.forEach(function(v,i){
        v.sort(function(a,b){ return a-b; });
        var last = v.length-1,p = cd[i];
        p.y = v; // put all points into calcdata
        p.min = v[0];
        p.max = v[last];
        p.mean = Plotly.Lib.mean(v,last+1);
        p.sd = Plotly.Lib.stdev(v,last+1,p.mean);
        p.q1 = interp(v,(last/4)); // first quartile
        p.med = interp(v,(last/2)); // median
        p.q3 = interp(v,(0.75*last)); // third quartile
        // lower and upper fences - last point inside
        // 1.5 interquartile ranges from quartiles
        p.lf = Math.min(p.q1,v[Plotly.Lib.findBin(2.5*p.q1-1.5*p.q3,v,true)+1]);
        p.uf = Math.max(p.q3,v[Plotly.Lib.findBin(2.5*p.q3-1.5*p.q1,v)]);
        // lower and upper outliers - 3 IQR out (don't clip to max/min,
        // this is only for discriminating suggested & far outliers)
        p.lo = 4*p.q1-3*p.q3;
        p.uo = 4*p.q3-3*p.q1;
    });
    cd[0].t = {boxnum: gd.numboxes, dx: dx};
    gd.numboxes++;
    return cd;
};

boxes.setPositions = function(gd) {
    var xa = gd.layout.xaxis,
        boxlist=[];
    gd.calcdata.forEach(function(cd,i) {
        var t=cd[0].t;
        if(t.visible!==false && t.type=='box') { boxlist.push(i); }
    });

    // box plots - update dx based on multiple traces, and then use for x autorange
    var boxx = [];
    boxlist.forEach(function(i){ gd.calcdata[i].forEach(function(v){ boxx.push(v.x); }); });
    if(boxx.length) {
        var boxdv = Plotly.Lib.distinctVals(boxx),
            dx = boxdv.minDiff/2;
        Plotly.Axes.expandBounds(xa,xa._padded,boxdv.vals,null,dx);
        boxlist.forEach(function(i){ gd.calcdata[i][0].t.dx = dx; });
        // if there's no duplication of x points, disable 'group' mode by setting numboxes=1
        if(boxx.length==boxdv.vals.length) { gd.numboxes = 1; }
    }
};

boxes.plot = function(gd,cdbox) {
    var gl = gd.layout,
        xa = gl.xaxis,
        ya = gl.yaxis;
    var boxtraces = gd.plot.selectAll('g.trace.boxes') // <-- select trace group
        .data(cdbox) // <-- bind calcdata to traces
      .enter().append('g') // <-- add a trace for each calcdata
        .attr('class','trace boxes');
    boxtraces.each(function(d){
        var t = d[0].t,
            group = (gl.boxmode=='group' && gd.numboxes>1), // like grouped bars
            // box half width
            bdx = t.dx*(1-gl.boxgap)*(1-gl.boxgroupgap)/(group ? gd.numboxes : 1),
            // box center offset
            bx = group ? 2*t.dx*(-0.5+(t.boxnum+0.5)/gd.numboxes)*(1-gl.boxgap) : 0,
            wdx = bdx*t.ww; // whisker width
        // save the box size and box position for use by hover
        t.bx = bx;
        t.bdx = bdx;
        // boxes and whiskers
        d3.select(this).selectAll('path.box')
            .data(Plotly.Lib.identity)
            .enter().append('path')
            .attr('class','box')
            .each(function(d){
                // draw the bars and whiskers
                var xc = xa.c2p(d.x+bx,true),
                    x0 = xa.c2p(d.x+bx-bdx,true),
                    x1 = xa.c2p(d.x+bx+bdx,true),
                    xw0 = xa.c2p(d.x+bx-wdx,true),
                    xw1 = xa.c2p(d.x+bx+wdx,true),
                    ym = ya.c2p(d.med,true),
                    yq1 = ya.c2p(d.q1,true),
                    yq3 = ya.c2p(d.q3,true),
                    ylf = ya.c2p(t.boxpts===false ? d.min : d.lf, true),
                    yuf = ya.c2p(t.boxpts===false ? d.max : d.uf, true);
                d3.select(this).attr('d',
                    'M'+x0+','+ym+'H'+x1+ // median line
                    'M'+x0+','+yq1+'H'+x1+'V'+yq3+'H'+x0+'Z'+ // box
                    'M'+xc+','+yq1+'V'+ylf+'M'+xc+','+yq3+'V'+yuf+ // whiskers
                    ((t.ww===0) ? '' : // whisker caps
                        'M'+xw0+','+ylf+'H'+xw1+'M'+xw0+','+yuf+'H'+xw1));
            });
        // draw points, if desired
        if(t.boxpts!==false) {
            d3.select(this).selectAll('g.points')
                // since box plot points get an extra level of nesting, each
                // box needs the trace styling info
                .data(function(d){ d.forEach(function(v){v.t=t;}); return d; })
                .enter().append('g')
                .attr('class','points')
              .selectAll('path')
                .data(function(d){
                    var pts = (t.boxpts=='all') ? d.y :
                        d.y.filter(function(v){ return (v<d.lf || v>d.uf); });
                    return pts.map(function(v){
                        var xo = (t.jitter ? t.jitter*(Math.random()-0.5)*2 : 0)+t.ptpos,
                            p = {x:d.x+xo*bdx+bx,y:v,t:t};
                        // tag suggested outliers
                        if(t.boxpts!='all' && v<d.uo && v>d.lo) { p.so=true; }
                        return p;
                    });
                })
                .enter().append('path')
                .call(Plotly.Drawing.translatePoints,xa,ya);
        }
        // draw mean (and stdev diamond) if desired
        if(t.mean) {
            d3.select(this).selectAll('path.mean')
                .data(Plotly.Lib.identity)
                .enter().append('path')
                .attr('class','mean')
                .style('fill','none')
                .each(function(d){
                    var xc = xa.c2p(d.x+bx,true),
                        x0 = xa.c2p(d.x+bx-bdx,true),
                        x1 = xa.c2p(d.x+bx+bdx,true),
                        ym = ya.c2p(d.mean,true),
                        ysl = ya.c2p(d.mean-d.sd,true),
                        ysh = ya.c2p(d.mean+d.sd,true);
                    d3.select(this).attr('d','M'+x0+','+ym+'H'+x1+
                        ((t.mean!='sd') ? '' :
                        'm0,0L'+xc+','+ysl+'L'+x0+','+ym+'L'+xc+','+ysh+'Z'));
                });
        }
    });
};

boxes.style = function(s) {
    s.each(function(d){
        var t = d[0].t;
        d3.select(this).selectAll('path.box')
            .attr('stroke-width',t.lw)
            .call(Plotly.Drawing.strokeColor,t.lc)
            .call(Plotly.Drawing.fillColor,t.fc);
        d3.select(this).selectAll('path.mean')
            .attr('stroke-width',t.lw)
            .attr('stroke-dasharray',(2*t.lw)+','+(t.lw))
            .call(Plotly.Drawing.strokeColor,t.lc);
    });
};

// interpolate an array given a (possibly non-integer) index n
// clip the ends to the extreme values in the array
function interp(arr,n) {
    if(n<0) { return arr[0]; }
    if(n>arr.length-1) { return arr[arr.length-1]; }
    var frac = n%1;
    return frac*arr[Math.ceil(n)]+(1-frac)*arr[Math.floor(n)];
}

}()); // end Boxes object definition