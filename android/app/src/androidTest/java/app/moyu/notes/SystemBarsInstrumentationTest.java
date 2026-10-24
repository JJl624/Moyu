package app.moyu.notes;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
public class SystemBarsInstrumentationTest {
    @Test public void statusAndNavigationBackgroundsFollowTheirOwnSurfaces(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            SystemBarsLayout view=new SystemBarsLayout(InstrumentationRegistry.getInstrumentation().getTargetContext());view.setPadding(0,24,0,32);view.layout(0,0,100,200);
            Bitmap bitmap=Bitmap.createBitmap(100,200,Bitmap.Config.ARGB_8888);
            for(int top:new int[]{Color.rgb(246,247,250),Color.rgb(29,31,36)}){
                view.setBarColors(top,Color.WHITE);view.draw(new Canvas(bitmap));assertEquals(top,bitmap.getPixel(50,8));assertEquals(Color.WHITE,bitmap.getPixel(50,190));
            }bitmap.recycle();
        });
    }
}
