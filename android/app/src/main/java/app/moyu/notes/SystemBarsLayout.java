package app.moyu.notes;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.widget.FrameLayout;

/** Paint behind transparent system bars without moving controls into their insets. */
final class SystemBarsLayout extends FrameLayout {
    private final Paint status=new Paint(),navigation=new Paint();
    SystemBarsLayout(Context context){super(context);setWillNotDraw(false);}
    void setBarColors(int top,int bottom){status.setColor(top);navigation.setColor(bottom);setBackgroundColor(top);invalidate();}
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);
        canvas.drawRect(0,0,getWidth(),getPaddingTop(),status);
        canvas.drawRect(0,getHeight()-getPaddingBottom(),getWidth(),getHeight(),navigation);
    }
}
